// Instance lifecycle
export type InstanceStatus =
  | 'starting'
  | 'qr_ready'
  | 'authenticated'
  | 'ready'
  | 'disconnected'
  | 'error';

// Events that can trigger webhooks
export type WhatsAppEventType =
  | 'ready'
  | 'qr'
  | 'disconnected'
  | 'authenticated'
  | 'auth_failure'
  | 'message'
  | 'message_create'
  | 'message_ack'
  | 'message_revoke'
  | 'message_reaction'
  | 'message_ciphertext'
  | 'group_join'
  | 'group_leave'
  | 'group_update'
  | 'loading_screen'
  | 'change_state'
  | 'session_expired';

// Configuration for a WhatsApp instance
export interface InstanceConfig {
  /** Unique instance ID (e.g., 'bot-1', 'customer-support') */
  id: string;
  /** Run Puppeteer headless (default: true) */
  headless?: boolean;
  /** Protocol timeout in ms (default: 180000) */
  protocolTimeoutMs?: number;
  /** Auth timeout in ms (default: 120000) */
  authTimeoutMs?: number;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
}

// Webhook payload sent to WEBHOOK_URL
export interface WebhookPayload {
  /** Instance ID that generated the event */
  instanceId: string;
  /** Event type */
  event: WhatsAppEventType;
  /** ISO timestamp */
  timestamp: string;
  /** Event-specific data */
  data: Record<string, any>;
}

// QR Code event data
export interface QRData {
  /** QR code string (can be rendered as image or terminal) */
  qr: string;
}

// Message event data (normalized from WWebJS Message)
export interface MessageData {
  id: string;
  from: string;
  to?: string;
  fromMe: boolean;
  hasMedia: boolean;
  body: string;
  type: string;
  timestamp: number;
  /** Group ID if from group */
  groupId?: string;
  /** Author if from group */
  author?: string;
  /** Chat name (group name or contact name) */
  chatName?: string;
}

// Status response for an instance
export interface InstanceStatusResponse {
  id: string;
  status: InstanceStatus;
  phone?: string;
  /** ISO timestamp of last activity */
  lastActivity?: string;
  /** Error message if status is 'error' */
  error?: string;
}

// Chat/Group/Newsletter info
export interface ChatInfo {
  id: string;
  name: string;
  isGroup: boolean;
  isNewsletter: boolean;
  participantsCount?: number;
  unreadCount: number;
  isReadOnly: boolean;
}

// Send message options
export interface SendMessageOptions {
  /** Target chat ID (e.g., '5521999999999@c.us' or '123456@g.us') */
  chatId: string;
  /** Text content */
  text?: string;
  /** Image URL or local file path */
  imageUrl?: string;
  /** Document file path or URL */
  documentUrl?: string;
  /** Audio file path or URL */
  audioUrl?: string;
  /** Video file path or URL */
  videoUrl?: string;
  /** Delay before sending (ms) — for anti-ban */
  delayBeforeMs?: number;
  /** Simulate typing before sending */
  simulateTyping?: boolean;
}

// Send result
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Newsletter send options
export interface NewsletterSendOptions {
  newsletterId: string;
  text: string;
  imageUrl?: string;
}

export type {
  RuntimeSettings,
  SecuritySettings,
  RateLimitSettings,
  WebhookRuntimeSettings,
  AntiBanSettings,
  InstanceDefaultSettings,
  SecurityMode,
  MediaSourceMode,
  AntiBanProfileName,
} from './settings';
