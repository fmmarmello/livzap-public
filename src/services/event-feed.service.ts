export interface FeedEvent {
  type: 'instance_event' | 'webhook_delivery';
  timestamp: string;
  instanceId?: string;
  event?: string;
  success?: boolean;
  details?: Record<string, unknown>;
}

export class EventFeedService {
  private readonly maxEntries = 500;
  private events: FeedEvent[] = [];

  record(event: FeedEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEntries) {
      this.events.splice(0, this.events.length - this.maxEntries);
    }
  }

  list(limit = 100): FeedEvent[] {
    return this.events.slice(-limit).reverse();
  }
}

export const eventFeedService = new EventFeedService();

