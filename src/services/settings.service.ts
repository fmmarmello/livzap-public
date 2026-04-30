import fs from 'fs/promises';
import path from 'path';
import { RuntimeSettings } from '../types/settings';
import { parseBool, parseCsv, parseIntWithBounds } from '../utils/validation';
import { logger } from '../utils/logger';

const DEFAULT_DATA_DIR = path.join(process.cwd(), 'data');
const SETTINGS_FILE_NAME = 'settings.json';

function env(key: string, fallback = ''): string {
  return process.env[key] || fallback;
}

function buildDefaults(): RuntimeSettings {
  const webhookEvents = parseCsv(env('WEBHOOK_EVENTS', 'message,disconnected,ready,qr'));

  return {
    security: {
      securityMode: (env('SECURITY_MODE', 'strict') as RuntimeSettings['security']['securityMode']),
      apiKey: env('API_KEY', ''),
      allowedOrigins: parseCsv(env('ALLOWED_ORIGINS', '')),
      adminEnabled: parseBool(env('ADMIN_ENABLED', 'true'), true),
      adminSessionTtlMs: parseIntWithBounds(env('ADMIN_SESSION_TTL_MS', '900000'), 900000, 60000, 86400000),
      signedUrlTtlSec: parseIntWithBounds(env('SIGNED_URL_TTL_SEC', '120'), 120, 30, 3600),
      signedUrlSecret: env('SIGNED_URL_SECRET', env('API_KEY', '')),
      maxBodySize: env('MAX_BODY_SIZE', '1mb'),
      mediaSourceMode: (env('MEDIA_SOURCE_MODE', 'https_only') as RuntimeSettings['security']['mediaSourceMode']),
      mediaAllowedDomains: parseCsv(env('MEDIA_ALLOWED_DOMAINS', '')),
      mediaLocalBaseDir: env('MEDIA_LOCAL_BASE_DIR', path.join(process.cwd(), 'temp', 'uploads')),
      mediaMaxDownloadBytes: parseIntWithBounds(
        env('MEDIA_MAX_DOWNLOAD_BYTES', '15728640'),
        15728640,
        1048576,
        52428800,
      ),
    },
    rateLimit: {
      windowMs: parseIntWithBounds(env('RATE_LIMIT_WINDOW_MS', '60000'), 60000, 1000, 3600000),
      maxRequests: parseIntWithBounds(env('RATE_LIMIT_MAX_REQUESTS', '120'), 120, 10, 20000),
      authWindowMs: parseIntWithBounds(env('RATE_LIMIT_AUTH_WINDOW_MS', '60000'), 60000, 1000, 3600000),
      authMaxRequests: parseIntWithBounds(env('RATE_LIMIT_AUTH_MAX_REQUESTS', '30'), 30, 5, 1000),
    },
    webhook: {
      url: env('WEBHOOK_URL', ''),
      events: webhookEvents,
      secret: env('WEBHOOK_SECRET', ''),
      timeoutMs: parseIntWithBounds(env('WEBHOOK_TIMEOUT_MS', '10000'), 10000, 1000, 60000),
      maxRetries: parseIntWithBounds(env('WEBHOOK_MAX_RETRIES', '2'), 2, 1, 10),
    },
    antiBan: {
      profile: (env('ANTIBAN_PROFILE', 'conservative') as RuntimeSettings['antiBan']['profile']),
      minDelayMs: parseIntWithBounds(env('ANTIBAN_MIN_DELAY_MS', '1200'), 1200, 0, 30000),
      maxDelayMs: parseIntWithBounds(env('ANTIBAN_MAX_DELAY_MS', '4000'), 4000, 0, 60000),
      typingByDefault: parseBool(env('ANTIBAN_TYPING_BY_DEFAULT', 'true'), true),
      maxGlobalPerMinute: parseIntWithBounds(
        env('ANTIBAN_MAX_GLOBAL_PER_MINUTE', '40'),
        40,
        1,
        1000,
      ),
      maxPerChatPerMinute: parseIntWithBounds(
        env('ANTIBAN_MAX_PER_CHAT_PER_MINUTE', '12'),
        12,
        1,
        500,
      ),
      failureThreshold: parseIntWithBounds(env('ANTIBAN_FAILURE_THRESHOLD', '3'), 3, 1, 20),
      cooldownMs: parseIntWithBounds(env('ANTIBAN_COOLDOWN_MS', '60000'), 60000, 1000, 3600000),
      maxQueueSize: parseIntWithBounds(env('ANTIBAN_MAX_QUEUE_SIZE', '500'), 500, 10, 5000),
    },
    instanceDefaults: {
      headless: parseBool(env('WHATSAPP_HEADLESS', 'true'), true),
      protocolTimeoutMs: parseIntWithBounds(
        env('WHATSAPP_PROTOCOL_TIMEOUT_MS', '180000'),
        180000,
        10000,
        600000,
      ),
      authTimeoutMs: parseIntWithBounds(
        env('WHATSAPP_AUTH_TIMEOUT_MS', '120000'),
        120000,
        10000,
        600000,
      ),
      autoReconnect: parseBool(env('WHATSAPP_AUTO_RECONNECT', 'true'), true),
    },
  };
}

function mergeSettings(base: RuntimeSettings, patch: Partial<RuntimeSettings>): RuntimeSettings {
  return {
    ...base,
    ...patch,
    security: { ...base.security, ...(patch.security || {}) },
    rateLimit: { ...base.rateLimit, ...(patch.rateLimit || {}) },
    webhook: { ...base.webhook, ...(patch.webhook || {}) },
    antiBan: { ...base.antiBan, ...(patch.antiBan || {}) },
    instanceDefaults: { ...base.instanceDefaults, ...(patch.instanceDefaults || {}) },
  };
}

type Listener = (settings: RuntimeSettings) => void;

export class SettingsService {
  private readonly dataDir: string;
  private readonly settingsPath: string;
  private settings: RuntimeSettings = buildDefaults();
  private listeners = new Set<Listener>();

  constructor() {
    this.dataDir = env('DATA_DIR', DEFAULT_DATA_DIR);
    this.settingsPath = path.join(this.dataDir, SETTINGS_FILE_NAME);
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    this.settings = buildDefaults();
    try {
      const raw = await fs.readFile(this.settingsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
      this.settings = mergeSettings(this.settings, parsed);
    } catch {
      // No persisted settings yet.
    }
    await this.persist();
  }

  get(): RuntimeSettings {
    return JSON.parse(JSON.stringify(this.settings)) as RuntimeSettings;
  }

  getMutable(): RuntimeSettings {
    return this.settings;
  }

  async update(patch: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
    this.settings = mergeSettings(this.settings, patch);
    await this.persist();
    this.emit();
    return this.get();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.get());
      } catch (err) {
        logger.warn({ err }, 'Settings listener failed');
      }
    }
  }

  private async persist(): Promise<void> {
    await fs.writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf8');
  }
}

export const settingsService = new SettingsService();

