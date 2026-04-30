import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import QRCodeImage from 'qrcode';
import { mkdir, readFile, stat, unlink } from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import {
  InstanceConfig,
  InstanceStatus,
  WhatsAppEventType,
  ChatInfo,
  SendMessageOptions,
  SendResult,
  NewsletterSendOptions,
} from '../types';
import { whatsappLogger } from '../utils/logger';
import { assertValidInstanceId } from '../utils/validation';
import { getActiveAntiBanSettings } from '../services/anti-ban.service';
import { settingsService } from '../services/settings.service';
import { assertSafeRemoteHttpsUrl } from '../utils/network-security';

interface SendQueueItem {
  options: SendMessageOptions;
  resolve: (result: SendResult) => void;
}

// Browser context types (used inside pupPage.evaluate)
declare const window: any;

export class WhatsAppInstance extends EventEmitter {
  private client: Client | null = null;
  private _status: InstanceStatus = 'starting';
  private initializing = false;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private readonly KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
  private lastActivity: Date | null = null;
  private _phoneNumber: string | null = null;
  private sendQueue: SendQueueItem[] = [];
  private sendQueueProcessing = false;
  private sentGlobalInLastMinute: number[] = [];
  private sentPerChatInLastMinute = new Map<string, number[]>();
  private consecutiveFailures = 0;
  private blockedUntil = 0;

  public readonly id: string;
  private readonly config: Required<InstanceConfig>;

  constructor(config: InstanceConfig) {
    super();
    this.id = assertValidInstanceId(config.id);
    this.config = {
      headless: config.headless ?? true,
      protocolTimeoutMs: config.protocolTimeoutMs ?? 180000,
      authTimeoutMs: config.authTimeoutMs ?? 120000,
      autoReconnect: config.autoReconnect ?? true,
      id: this.id,
    };
  }

  // --- Public API ---

  get status(): InstanceStatus {
    return this._status;
  }

  get phoneNumber(): string | null {
    return this._phoneNumber;
  }

  get lastActivityDate(): Date | null {
    return this.lastActivity;
  }

  /** Initialize the WhatsApp connection */
  public initialize(): void {
    if (this.initializing) {
      whatsappLogger.warn({ instanceId: this.id }, 'Initialization already in progress');
      return;
    }
    if (this.client) {
      whatsappLogger.warn({ instanceId: this.id }, 'Client already exists');
      return;
    }

    this.initializing = true;
    this._status = 'starting';

    const sessionDir = path.join(process.cwd(), '.wwebjs_auth', `session-${this.id}`);

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: this.id, dataPath: sessionDir }),
      authTimeoutMs: this.config.authTimeoutMs,
      puppeteer: {
        headless: this.config.headless,
        protocolTimeout: this.config.protocolTimeoutMs,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      },
    });

    this.setupEventListeners();

    void this.initializeWithRecovery().finally(() => {
      this.initializing = false;
    });
  }

  /** Send a text or media message */
  public async sendMessage(options: SendMessageOptions): Promise<SendResult> {
    if (!this.client || this._status !== 'ready') {
      return { success: false, error: `Instance ${this.id} is not ready (status: ${this._status})` };
    }

    const antiBan = getActiveAntiBanSettings();
    if (this.sendQueue.length >= antiBan.maxQueueSize) {
      return {
        success: false,
        error: `Send queue is full (${antiBan.maxQueueSize}). Reduce burst and retry.`,
      };
    }

    return new Promise((resolve) => {
      this.sendQueue.push({ options, resolve });
      if (!this.sendQueueProcessing) {
        void this.processSendQueue();
      }
    });
  }

  /** Send message to a WhatsApp newsletter/channel */
  public async sendToNewsletter(options: NewsletterSendOptions): Promise<SendResult> {
    if (!this.client || this._status !== 'ready') {
      return { success: false, error: `Instance ${this.id} is not ready` };
    }

    const chatId = options.newsletterId.includes('@')
      ? options.newsletterId
      : `${options.newsletterId}@newsletter`;

    const pupPage = (this.client as any)?.pupPage;
    if (!pupPage) {
      return { success: false, error: 'pupPage not available' };
    }

    try {
      if (options.imageUrl) {
        const media = await this.loadMediaFromUrlOrPath(options.imageUrl);
        const mediaData = {
          data: media.data,
          mimetype: media.mimetype,
          filename: media.filename || 'media',
        };

        const result = await pupPage.evaluate(
          async (chatId: string, caption: string, mediaInfo: any) => {
            try {
              const chatWid = window.Store.WidFactory.createWid(chatId);
              let chat = window.Store.WAWebNewsletterMetadataCollection.get(chatId);
              if (!chat) {
                await window.Store.ChannelUtils.loadNewsletterPreviewChat(chatId);
                chat = await window.Store.WAWebNewsletterMetadataCollection.find(chatWid);
              }
              if (!chat) return { success: false, error: 'Newsletter chat not found' };

              const mediaOptions = await (window as any).WWebJS.processMediaData(mediaInfo, {
                forceSticker: false,
                forceGif: false,
                forceVoice: false,
                forceDocument: false,
                forceMediaHd: false,
                sendToChannel: true,
                sendToStatus: false,
              });
              mediaOptions.caption = caption;

              const meUser = window.Store.User.getMaybeMePnUser();
              const newId = await window.Store.MsgKey.newId();

              const newMsgKey = new window.Store.MsgKey({
                from: meUser,
                to: chat.id,
                id: newId,
                selfDir: 'out',
              });

              const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);

              const message = {
                id: newMsgKey,
                ack: 0,
                body: mediaOptions.preview || '',
                from: meUser,
                to: chat.id,
                local: true,
                self: 'out',
                t: parseInt(String(new Date().getTime() / 1000)),
                isNewMsg: true,
                type: 'chat',
                ...ephemeralFields,
                ...mediaOptions,
                ...(mediaOptions.toJSON ? mediaOptions.toJSON() : {}),
              };

              const msg = new window.Store.Msg.modelClass(message);
              const msgDataFromMsgModel = window.Store.SendChannelMessage.msgDataFromMsgModel(msg);
              await window.Store.SendChannelMessage.addNewsletterMsgsRecords([msgDataFromMsgModel]);

              if (chat.msgs && typeof chat.msgs.add === 'function') {
                chat.msgs.add(msg);
              }
              chat.t = msg.t;

              const sendResult = await window.Store.SendChannelMessage.sendNewsletterMessageJob({
                msg,
                type: 'media',
                newsletterJid: chat.id.toJid(),
                mediaMetadata: msg.avParams(),
                mediaHandle: mediaOptions.mediaHandle || null,
              });

              if (sendResult.success) {
                msg.t = sendResult.ack.t;
                msg.serverId = sendResult.serverId;
              }
              msg.updateAck(1, true);
              await window.Store.SendChannelMessage.updateNewsletterMsgRecord(msg);

              return { success: true };
            } catch (err: any) {
              return { success: false, error: err?.message || String(err) };
            }
          },
          chatId,
          options.text,
          mediaData,
        );

        if (!result?.success) {
          return { success: false, error: `Newsletter send failed: ${result?.error || 'unknown'}` };
        }
      } else {
        const result = await pupPage.evaluate(
          async (chatId: string, content: string) => {
            try {
              const chatWid = window.Store.WidFactory.createWid(chatId);
              let chat = window.Store.WAWebNewsletterMetadataCollection.get(chatId);
              if (!chat) {
                await window.Store.ChannelUtils.loadNewsletterPreviewChat(chatId);
                chat = await window.Store.WAWebNewsletterMetadataCollection.find(chatWid);
              }
              if (!chat) return { success: false, error: 'Newsletter chat not found' };

              const meUser = window.Store.User.getMaybeMePnUser();
              const newId = await window.Store.MsgKey.newId();

              const newMsgKey = new window.Store.MsgKey({
                from: meUser,
                to: chat.id,
                id: newId,
                selfDir: 'out',
              });

              const ephemeralFields = window.Store.EphemeralFields.getEphemeralFields(chat);

              const message = {
                id: newMsgKey,
                ack: 0,
                body: content,
                from: meUser,
                to: chat.id,
                local: true,
                self: 'out',
                t: parseInt(String(new Date().getTime() / 1000)),
                isNewMsg: true,
                type: 'chat',
                ...ephemeralFields,
              };

              const msg = new window.Store.Msg.modelClass(message);
              const msgDataFromMsgModel = window.Store.SendChannelMessage.msgDataFromMsgModel(msg);
              await window.Store.SendChannelMessage.addNewsletterMsgsRecords([msgDataFromMsgModel]);

              if (chat.msgs && typeof chat.msgs.add === 'function') {
                chat.msgs.add(msg);
              }
              chat.t = msg.t;

              const sendResult = await window.Store.SendChannelMessage.sendNewsletterMessageJob({
                msg,
                type: 'chat',
                newsletterJid: chat.id.toJid(),
              });

              if (sendResult.success) {
                msg.t = sendResult.ack.t;
                msg.serverId = sendResult.serverId;
              }
              msg.updateAck(1, true);
              await window.Store.SendChannelMessage.updateNewsletterMsgRecord(msg);

              return { success: true };
            } catch (err: any) {
              return { success: false, error: err?.message || String(err) };
            }
          },
          chatId,
          options.text,
        );

        if (!result?.success) {
          return { success: false, error: `Newsletter send failed: ${result?.error || 'unknown'}` };
        }
      }

      this.lastActivity = new Date();
      return { success: true };
    } catch (err) {
      const error = err as Error;
      whatsappLogger.error({ instanceId: this.id, err: error }, 'Failed to send to newsletter');
      return { success: false, error: error.message };
    }
  }

  /** List all chats (groups + newsletters) */
  public async listChats(): Promise<ChatInfo[]> {
    if (!this.client || this._status !== 'ready') return [];

    try {
      const chats = await this.client.getChats();
      let channels: any[] = [];
      try {
        if ((this.client as any).getChannels) {
          channels = await (this.client as any).getChannels();
        }
      } catch {
        // getChannels not available
      }

      const allItems = [...chats, ...channels];
      const uniqueItems = new Map();
      allItems.forEach((item: any) => {
        if (item?.id?._serialized) {
          uniqueItems.set(item.id._serialized, item);
        }
      });

      const filtered = Array.from(uniqueItems.values()).filter(
        (chat: any) =>
          chat.id._serialized.endsWith('@g.us') || chat.id._serialized.endsWith('@newsletter'),
      );

      return filtered.map((chat: any) => ({
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.id._serialized.endsWith('@g.us'),
        isNewsletter: chat.id._serialized.endsWith('@newsletter'),
        participantsCount: chat.isGroup ? chat.participants?.length : undefined,
        unreadCount: chat.unreadCount || 0,
        isReadOnly: chat.isReadOnly || false,
      }));
    } catch (err) {
      whatsappLogger.error({ instanceId: this.id, err }, 'Failed to list chats');
      return [];
    }
  }

  /** Get the raw WWebJS client for advanced usage */
  public getRawClient(): Client | null {
    return this.client;
  }

  /** Get the Puppeteer page for direct browser automation */
  public getPupPage(): any | null {
    return (this.client as any)?.pupPage || null;
  }

  /** Gracefully shutdown */
  public async shutdown(): Promise<void> {
    this._status = 'disconnected';
    this.stopKeepAlive();
    while (this.sendQueue.length > 0) {
      const item = this.sendQueue.shift()!;
      item.resolve({ success: false, error: 'Instance is shutting down' });
    }
    if (this.client) {
      try {
        await this.client.destroy();
        whatsappLogger.info({ instanceId: this.id }, 'Client destroyed');
      } catch (err) {
        whatsappLogger.warn({ instanceId: this.id, err }, 'Failed to destroy client cleanly');
      }
      this.client = null;
    }
  }

  // --- Private internals ---

  private setStatus(status: InstanceStatus) {
    this._status = status;
    this.lastActivity = new Date();
    this.emit('status', status);
    this.emit('status_change', { instanceId: this.id, status });
  }

  private async processSendQueue(): Promise<void> {
    if (this.sendQueueProcessing) return;
    this.sendQueueProcessing = true;

    while (this.sendQueue.length > 0) {
      const item = this.sendQueue.shift()!;
      try {
        const result = await this.sendMessageInternal(item.options);
        item.resolve(result);
      } catch (err) {
        const error = err as Error;
        item.resolve({ success: false, error: error.message });
      }
    }

    this.sendQueueProcessing = false;
  }

  private async sendMessageInternal(options: SendMessageOptions): Promise<SendResult> {
    if (!this.client || this._status !== 'ready') {
      return { success: false, error: `Instance ${this.id} is not ready (status: ${this._status})` };
    }

    const antiBan = getActiveAntiBanSettings();
    const now = Date.now();
    if (now < this.blockedUntil) {
      return {
        success: false,
        error: `Instance temporarily cooling down. Retry after ${Math.ceil(
          (this.blockedUntil - now) / 1000,
        )}s`,
      };
    }

    await this.applyRateLimits(options.chatId, antiBan);

    const randomJitter = antiBan.minDelayMs + Math.floor(Math.random() * (antiBan.maxDelayMs - antiBan.minDelayMs + 1));
    const explicitDelay = Math.max(0, options.delayBeforeMs || 0);
    const waitMs = Math.max(randomJitter, explicitDelay);
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }

    try {
      const shouldType =
        typeof options.simulateTyping === 'boolean' ? options.simulateTyping : antiBan.typingByDefault;

      if (shouldType && options.text) {
        const chat = await this.client.getChatById(options.chatId);
        await chat.sendStateTyping();
        const textLen = options.text.length || 20;
        await new Promise((r) => setTimeout(r, Math.min(textLen * 50, 5000)));
        await chat.clearState();
      }

      let result: any;
      if (options.imageUrl) {
        const media = await this.loadMediaFromUrlOrPath(options.imageUrl);
        result = await this.client.sendMessage(options.chatId, media, {
          caption: options.text,
          parseVCards: false,
        });
      } else if (options.documentUrl) {
        const media = await this.loadMediaFromUrlOrPath(options.documentUrl);
        result = await this.client.sendMessage(options.chatId, media, {
          parseVCards: false,
        });
      } else if (options.audioUrl) {
        const media = await this.loadMediaFromUrlOrPath(options.audioUrl);
        result = await this.client.sendMessage(options.chatId, media, {
          parseVCards: false,
        });
      } else if (options.videoUrl) {
        const media = await this.loadMediaFromUrlOrPath(options.videoUrl);
        result = await this.client.sendMessage(options.chatId, media, {
          caption: options.text,
          parseVCards: false,
        });
      } else if (options.text) {
        result = await this.client.sendMessage(options.chatId, options.text, {
          parseVCards: false,
        });
      } else {
        return { success: false, error: 'No text or media provided' };
      }

      this.recordSend(options.chatId);
      this.consecutiveFailures = 0;
      this.lastActivity = new Date();
      return { success: true, messageId: result?.id?._serialized };
    } catch (err) {
      const error = err as Error;
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= antiBan.failureThreshold) {
        this.blockedUntil = Date.now() + antiBan.cooldownMs;
        this.consecutiveFailures = 0;
      }
      whatsappLogger.error({ instanceId: this.id, err: error }, 'Failed to send message');
      return { success: false, error: error.message };
    }
  }

  private recordSend(chatId: string): void {
    const now = Date.now();
    const globalCutoff = now - 60000;

    this.sentGlobalInLastMinute.push(now);
    this.sentGlobalInLastMinute = this.sentGlobalInLastMinute.filter((t) => t >= globalCutoff);

    const perChat = this.sentPerChatInLastMinute.get(chatId) || [];
    perChat.push(now);
    this.sentPerChatInLastMinute.set(
      chatId,
      perChat.filter((t) => t >= globalCutoff),
    );
  }

  private async applyRateLimits(chatId: string, antiBan: ReturnType<typeof getActiveAntiBanSettings>): Promise<void> {
    const now = Date.now();
    const cutoff = now - 60000;
    this.sentGlobalInLastMinute = this.sentGlobalInLastMinute.filter((t) => t >= cutoff);
    const perChat = (this.sentPerChatInLastMinute.get(chatId) || []).filter((t) => t >= cutoff);
    this.sentPerChatInLastMinute.set(chatId, perChat);

    let requiredWaitMs = 0;
    if (this.sentGlobalInLastMinute.length >= antiBan.maxGlobalPerMinute) {
      const oldest = this.sentGlobalInLastMinute[0] || now;
      requiredWaitMs = Math.max(requiredWaitMs, oldest + 60000 - now);
    }
    if (perChat.length >= antiBan.maxPerChatPerMinute) {
      const oldestChat = perChat[0] || now;
      requiredWaitMs = Math.max(requiredWaitMs, oldestChat + 60000 - now);
    }

    if (requiredWaitMs > 0) {
      await new Promise((r) => setTimeout(r, requiredWaitMs));
    }
  }

  private async initializeWithRecovery(): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.client!.initialize();
        return;
      } catch (err) {
        const error = err as Error;
        const lockedProfile = this.isProfileLockedError(error);
        const isProtocolError =
          error?.name === 'ProtocolError' ||
          error?.message?.includes('Execution context was destroyed');

        if (attempt === maxAttempts) {
          whatsappLogger.error(
            { instanceId: this.id, err: error, attempt },
            'Initialization failed',
          );
          this.setStatus('error');
          this.emit('error', error);
          return;
        }

        if (lockedProfile) {
          await this.recoverProfileLock();
        } else if (isProtocolError) {
          // Will retry after delay
        } else {
          whatsappLogger.error(
            { instanceId: this.id, err: error, attempt },
            'Unexpected initialization error',
          );
          this.setStatus('error');
          this.emit('error', error);
          return;
        }

        const delayMs = 5000 * attempt;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private isProfileLockedError(error: Error): boolean {
    const message = error?.message || '';
    return message.includes('already running') || message.includes('Use a different `userDataDir`');
  }

  private async recoverProfileLock(): Promise<void> {
    const sessionDir = path.join(process.cwd(), '.wwebjs_auth', `session-${this.id}`);
    const lockCandidates = [
      path.join(sessionDir, 'SingletonLock'),
      path.join(sessionDir, 'SingletonSocket'),
      path.join(sessionDir, 'SingletonCookie'),
      path.join(sessionDir, 'lockfile'),
      path.join(sessionDir, 'Default', 'SingletonLock'),
      path.join(sessionDir, 'Default', 'SingletonSocket'),
      path.join(sessionDir, 'Default', 'SingletonCookie'),
      path.join(sessionDir, 'Default', 'lockfile'),
    ];

    for (const lockPath of lockCandidates) {
      try {
        await unlink(lockPath);
        whatsappLogger.warn({ lockPath }, 'Removed stale lock');
      } catch {
        // ignore
      }
    }
  }

  private setupEventListeners() {
    if (!this.client) return;

    this.client.on('qr', async (qr) => {
      this.setStatus('qr_ready');
      whatsappLogger.info({ instanceId: this.id }, 'QR Code received');
      qrcode.generate(qr, { small: true });

      try {
        const tempDir = path.join(process.cwd(), 'temp');
        await mkdir(tempDir, { recursive: true });
        const qrPath = path.join(tempDir, `qr-${this.id}.png`);
        await QRCodeImage.toFile(qrPath, qr, { scale: 8 });
      } catch {
        // ignore QR save failure
      }

      this.emit('event', { event: 'qr' as WhatsAppEventType, data: { qr } });
    });

    this.client.on('ready', () => {
      this.setStatus('ready');
      whatsappLogger.info({ instanceId: this.id }, 'WhatsApp is READY');

      // Extract phone number
      void (async () => {
        try {
          const info = await this.client!.info;
          this._phoneNumber = (info as any)?.wid?.user || (info as any)?.user || null;
        } catch {
          // ignore
        }
      })();

      this.startKeepAlive();
      this.emit('event', { event: 'ready' as WhatsAppEventType, data: {} });
    });

    this.client.on('authenticated', () => {
      this.setStatus('authenticated');
      this.emit('event', { event: 'authenticated' as WhatsAppEventType, data: {} });
    });

    this.client.on('auth_failure', (msg) => {
      whatsappLogger.error({ instanceId: this.id, msg }, 'Auth failure');
      this.setStatus('error');
      this.emit('event', { event: 'auth_failure' as WhatsAppEventType, data: { msg } });
    });

    this.client.on('disconnected', (reason) => {
      this.stopKeepAlive();
      whatsappLogger.warn({ instanceId: this.id, reason }, 'Disconnected');
      this.setStatus('disconnected');
      this.emit('event', { event: 'disconnected' as WhatsAppEventType, data: { reason } });

      if (this.config.autoReconnect) {
        whatsappLogger.info({ instanceId: this.id }, 'Auto-reconnecting in 5s...');
        setTimeout(() => {
          if (this._status === 'disconnected') {
            void this.shutdown().then(() => {
              this.initialize();
            });
          }
        }, 5000);
      }
    });

    this.client.on('session_expired', () => {
      this.stopKeepAlive();
      whatsappLogger.warn({ instanceId: this.id }, 'Session expired');
      this.setStatus('disconnected');
      this.emit('event', { event: 'session_expired' as WhatsAppEventType, data: {} });
    });

    this.client.on('loading_screen', (percent: number, message: string) => {
      this.emit('event', {
        event: 'loading_screen' as WhatsAppEventType,
        data: { percent, message },
      });
    });

    this.client.on('change_state', (state: any) => {
      this.emit('event', {
        event: 'change_state' as WhatsAppEventType,
        data: { state },
      });
    });

    this.client.on('message', async (msg: Message) => {
      const data = await this.normalizeMessage(msg);
      this.lastActivity = new Date();
      this.emit('event', { event: 'message' as WhatsAppEventType, data });
    });

    this.client.on('message_create', async (msg: Message) => {
      if (msg.fromMe) return;
      const data = await this.normalizeMessage(msg);
      this.lastActivity = new Date();
      this.emit('event', { event: 'message_create' as WhatsAppEventType, data });
    });
  }

  private async normalizeMessage(msg: Message): Promise<any> {
    const data: any = {
      id: msg.id?._serialized || msg.id?.id || '',
      from: msg.from || '',
      fromMe: msg.fromMe,
      hasMedia: msg.hasMedia,
      body: msg.body || '',
      type: msg.type,
      timestamp: msg.timestamp,
    };

    if (msg.from && msg.from.includes('@g.us')) {
      data.groupId = msg.from;
      data.author = msg.author || '';
    }

    try {
      if (msg.getChat) {
        const c = await msg.getChat();
        data.chatName = c?.name || '';
      }
    } catch {
      // ignore
    }

    return data;
  }

  private startKeepAlive(): void {
    if (this.keepAliveInterval) return;

    this.keepAliveInterval = setInterval(async () => {
      try {
        const pupPage = (this.client as any)?.pupPage;
        if (!pupPage) return;

        const isDetached =
          !pupPage.isClosed?.() &&
          (!pupPage.mainFrame?.() || pupPage.mainFrame()?.isDetached?.());
        if (isDetached) {
          this.stopKeepAlive();
          return;
        }

        await pupPage.evaluate(() => {
          if (
            typeof window.Store !== 'undefined' &&
            (window.Store as any).Wap &&
            typeof (window.Store as any).Wap.createChat === 'function'
          ) {
            ((window.Store as any).Wap as any).queryExistingChatIds().catch(() => {});
          }
        });
      } catch (err) {
        const error = err as Error;
        if (
          error?.message?.includes('detached Frame') ||
          error?.message?.includes('Execution context was destroyed')
        ) {
          this.stopKeepAlive();
          return;
        }
      }
    }, this.KEEPALIVE_INTERVAL_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  private async loadMediaFromUrlOrPath(urlOrPath: string): Promise<MessageMedia> {
    const settings = settingsService.get().security;
    const source = String(urlOrPath || '').trim();

    if (source.startsWith('http://')) {
      throw new Error('Only HTTPS media URLs are allowed');
    }

    if (source.startsWith('https://')) {
      const safeUrl = await assertSafeRemoteHttpsUrl(source, settings.mediaAllowedDomains);
      return this.loadMediaFromHttps(safeUrl);
    }

    if (settings.mediaSourceMode !== 'https_and_local') {
      throw new Error('Local media paths are disabled by MEDIA_SOURCE_MODE=https_only');
    }

    return this.loadMediaFromLocalPath(source, settings.mediaLocalBaseDir);
  }

  private async loadMediaFromHttps(url: URL): Promise<MessageMedia> {
    const settings = settingsService.get().security;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch media: HTTP ${response.status}`);
      }

      const maxBytes = settings.mediaMaxDownloadBytes;
      const lenHeader = Number.parseInt(String(response.headers.get('content-length') || ''), 10);
      if (Number.isFinite(lenHeader) && lenHeader > maxBytes) {
        throw new Error(`Media too large. Max allowed: ${maxBytes} bytes`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Empty media response body');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buff = Buffer.from(value);
        total += buff.length;
        if (total > maxBytes) {
          throw new Error(`Media too large. Max allowed: ${maxBytes} bytes`);
        }
        chunks.push(buff);
      }

      const buffer = Buffer.concat(chunks);
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const filename = path.basename(url.pathname) || 'media';
      return new MessageMedia(contentType, buffer.toString('base64'), filename, total);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadMediaFromLocalPath(inputPath: string, baseDir: string): Promise<MessageMedia> {
    const resolvedBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(inputPath);
    const relative = path.relative(resolvedBase, resolvedPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Local media path is outside allowed MEDIA_LOCAL_BASE_DIR');
    }

    const file = await stat(resolvedPath);
    const maxBytes = settingsService.get().security.mediaMaxDownloadBytes;
    if (file.size > maxBytes) {
      throw new Error(`Media too large. Max allowed: ${maxBytes} bytes`);
    }

    const buffer = await readFile(resolvedPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    const mime = extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.png'
        ? 'image/png'
        : extension === '.gif'
          ? 'image/gif'
          : extension === '.mp4'
            ? 'video/mp4'
            : extension === '.mp3'
              ? 'audio/mpeg'
              : 'application/octet-stream';

    return new MessageMedia(mime, buffer.toString('base64'), path.basename(resolvedPath), buffer.length);
  }
}
