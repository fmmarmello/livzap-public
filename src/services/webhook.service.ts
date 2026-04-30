import { WhatsAppEventType, WebhookPayload } from '../types';
import { webhookLogger } from '../utils/logger';
import crypto from 'crypto';
import { eventFeedService } from './event-feed.service';

export interface WebhookConfig {
  /** URL to POST events to */
  url: string;
  /** Which events to forward */
  events: WhatsAppEventType[];
  /** Shared secret for HMAC signature verification */
  secret?: string;
  /** Timeout in ms for webhook POST */
  timeoutMs?: number;
  /** Max retries on failure */
  maxRetries?: number;
}

export class WebhookService {
  private config: WebhookConfig | null = null;

  configure(config: WebhookConfig | null) {
    this.config = config;
  }

  async dispatch(instanceId: string, event: WhatsAppEventType, data: any): Promise<void> {
    if (!this.config?.url) return;
    if (!this.config.events.includes(event)) return;

    const payload: WebhookPayload = {
      instanceId,
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-LivZap-Instance': instanceId,
      'X-LivZap-Event': event,
    };

    if (this.config.secret) {
      const sig = crypto.createHmac('sha256', this.config.secret).update(body).digest('hex');
      headers['X-LivZap-Signature'] = `sha256=${sig}`;
    }

    const timeout = this.config.timeoutMs ?? 10000;
    const maxRetries = this.config.maxRetries ?? 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        const res = await fetch(this.config.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        if (attempt > 1) {
          webhookLogger.info({ instanceId, event, attempt }, 'Webhook sent (after retry)');
        }
        eventFeedService.record({
          type: 'webhook_delivery',
          timestamp: new Date().toISOString(),
          instanceId,
          event,
          success: true,
          details: {
            attempt,
            url: this.config.url,
          },
        });
        return;
      } catch (err) {
        const error = err as Error;
        webhookLogger.warn(
          { instanceId, event, attempt, maxRetries, error: error.message },
          'Webhook delivery failed',
        );

        if (attempt === maxRetries) {
          webhookLogger.error(
            { instanceId, event, error: error.message },
            'Webhook delivery exhausted retries',
          );
          eventFeedService.record({
            type: 'webhook_delivery',
            timestamp: new Date().toISOString(),
            instanceId,
            event,
            success: false,
            details: {
              attempt,
              maxRetries,
              error: error.message,
              url: this.config.url,
            },
          });
        } else {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
        }
      }
    }
  }
}

export const webhookService = new WebhookService();
