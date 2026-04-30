export type SecurityMode = 'strict' | 'balanced' | 'relaxed';
export type MediaSourceMode = 'https_only' | 'https_and_local';
export type AntiBanProfileName = 'conservative' | 'moderate' | 'custom';

export interface SecuritySettings {
  securityMode: SecurityMode;
  apiKey: string;
  allowedOrigins: string[];
  adminEnabled: boolean;
  adminSessionTtlMs: number;
  signedUrlTtlSec: number;
  signedUrlSecret: string;
  maxBodySize: string;
  mediaSourceMode: MediaSourceMode;
  mediaAllowedDomains: string[];
  mediaLocalBaseDir: string;
  mediaMaxDownloadBytes: number;
}

export interface RateLimitSettings {
  windowMs: number;
  maxRequests: number;
  authWindowMs: number;
  authMaxRequests: number;
}

export interface WebhookRuntimeSettings {
  url: string;
  events: string[];
  secret: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface AntiBanSettings {
  profile: AntiBanProfileName;
  minDelayMs: number;
  maxDelayMs: number;
  typingByDefault: boolean;
  maxGlobalPerMinute: number;
  maxPerChatPerMinute: number;
  failureThreshold: number;
  cooldownMs: number;
  maxQueueSize: number;
}

export interface InstanceDefaultSettings {
  headless: boolean;
  protocolTimeoutMs: number;
  authTimeoutMs: number;
  autoReconnect: boolean;
}

export interface RuntimeSettings {
  security: SecuritySettings;
  rateLimit: RateLimitSettings;
  webhook: WebhookRuntimeSettings;
  antiBan: AntiBanSettings;
  instanceDefaults: InstanceDefaultSettings;
}

