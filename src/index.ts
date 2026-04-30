// Core classes
export { WhatsAppInstance } from './client/whatsapp-client';
export { InstanceManager } from './client/instance-manager';

// Services
export { MediaService, mediaService } from './services/media.service';
export { WebhookService } from './services/webhook.service';
export { settingsService } from './services/settings.service';
export { getActiveAntiBanSettings } from './services/anti-ban.service';

// Types
export type {
  InstanceConfig,
  InstanceStatus,
  WhatsAppEventType,
  WebhookPayload,
  MessageData,
  ChatInfo,
  SendMessageOptions,
  SendResult,
  NewsletterSendOptions,
  QRData,
  InstanceStatusResponse,
  RuntimeSettings,
  SecuritySettings,
  RateLimitSettings,
  WebhookRuntimeSettings,
  AntiBanSettings,
  InstanceDefaultSettings,
  SecurityMode,
  MediaSourceMode,
  AntiBanProfileName,
} from './types';

// Logger
export { logger, whatsappLogger, apiLogger, webhookLogger } from './utils/logger';
