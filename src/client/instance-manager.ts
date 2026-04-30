import { WhatsAppInstance } from './whatsapp-client';
import { InstanceConfig, InstanceStatusResponse } from '../types';
import { whatsappLogger } from '../utils/logger';
import { webhookService } from '../services/webhook.service';
import { discoverService } from '../services/discover.service';
import { eventFeedService } from '../services/event-feed.service';
import { assertValidInstanceId } from '../utils/validation';

export class InstanceManager {
  private instances = new Map<string, WhatsAppInstance>();

  /** Create and initialize a new instance */
  createInstance(config: InstanceConfig): WhatsAppInstance {
    const safeId = assertValidInstanceId(config.id);
    if (this.instances.has(safeId)) {
      const existing = this.instances.get(safeId)!;
      whatsappLogger.warn({ instanceId: safeId }, 'Instance already exists, returning existing');
      return existing;
    }

    const instance = new WhatsAppInstance({ ...config, id: safeId });

    // Forward instance events to webhook + discover
    instance.on('event', async ({ event, data }: { event: string; data: any }) => {
      eventFeedService.record({
        type: 'instance_event',
        timestamp: new Date().toISOString(),
        instanceId: safeId,
        event,
      });

      await webhookService.dispatch(safeId, event as any, data);

      // Record incoming messages for discovery feed
      if (event === 'message' && !data.fromMe) {
        const chatId = data.from || '';
        discoverService.recordMessage(
          safeId,
          chatId,
          data.chatName || chatId,
          chatId.endsWith('@g.us'),
          chatId.endsWith('@newsletter'),
          data,
        );
      }
    });

    instance.on('status', (status) => {
      whatsappLogger.info({ instanceId: safeId, status }, 'Status changed');
    });

    this.instances.set(safeId, instance);
    whatsappLogger.info({ instanceId: safeId }, 'Instance created');

    return instance;
  }

  /** Get instance by ID */
  getInstance(id: string): WhatsAppInstance | undefined {
    return this.instances.get(id);
  }

  /** List all instances with status */
  listInstances(): InstanceStatusResponse[] {
    const results: InstanceStatusResponse[] = [];
    for (const [id, instance] of this.instances) {
      results.push({
        id,
        status: instance.status,
        phone: instance.phoneNumber || undefined,
        lastActivity: instance.lastActivityDate?.toISOString(),
      });
    }
    return results;
  }

  /** Shutdown and remove an instance */
  async removeInstance(id: string): Promise<boolean> {
    const instance = this.instances.get(id);
    if (!instance) return false;

    await instance.shutdown();
    this.instances.delete(id);
    discoverService.clearInstance(id);
    whatsappLogger.info({ instanceId: id }, 'Instance removed');
    return true;
  }

  /** Shutdown all instances */
  async shutdownAll(): Promise<void> {
    const promises = Array.from(this.instances.values()).map((i) => i.shutdown());
    await Promise.allSettled(promises);
    this.instances.clear();
  }
}

export const instanceManager = new InstanceManager();
