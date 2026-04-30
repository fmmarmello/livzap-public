import { MessageData } from '../types';
import { discoverLogger } from '../utils/logger';

interface DiscoverMessage extends MessageData {
  chatId: string;
  chatName: string;
  isGroup: boolean;
  isNewsletter: boolean;
}

interface DiscoverChatEntry extends DiscoverMessage {
  unreadCount: number;
}

export class DiscoverService {
  // Circular buffer: recent messages per instance
  private buffers = new Map<string, DiscoverMessage[]>();
  private readonly MAX_BUFFER_SIZE = 1000;

  /**
   * Record an incoming message for later discovery
   */
  recordMessage(
    instanceId: string,
    chatId: string,
    chatName: string,
    isGroup: boolean,
    isNewsletter: boolean,
    msg: MessageData,
  ): void {
    let buffer = this.buffers.get(instanceId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(instanceId, buffer);
    }

    const entry: DiscoverMessage = {
      ...msg,
      chatId,
      chatName,
      isGroup,
      isNewsletter,
    };

    buffer.push(entry);

    // Trim to MAX_BUFFER_SIZE (simple cap, not circular)
    if (buffer.length > this.MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - this.MAX_BUFFER_SIZE);
    }

    discoverLogger.debug(
      { instanceId, chatId, bufferSize: buffer.length },
      'Message recorded for discovery',
    );
  }

  /**
   * Get recent messages for an instance
   * @param instanceId Instance ID
   * @param windowMs Time window in ms (default: 60000 = last minute)
   * @param limit Max messages to return (default: 50)
   * @param type Filter by sender type: 'all' | 'contact' | 'group' | 'newsletter'
   */
  getRecentMessages(
    instanceId: string,
    windowMs = 60000,
    limit = 50,
    type: 'all' | 'contact' | 'group' | 'newsletter' = 'all',
  ): DiscoverMessage[] {
    const buffer = this.buffers.get(instanceId) || [];
    const cutoff = Date.now() - windowMs;

    let filtered = buffer.filter((msg) => {
      // Must be incoming (not from me)
      if (msg.fromMe) return false;
      // Must be within time window
      if (msg.timestamp * 1000 < cutoff) return false;
      // Type filter
      if (type === 'group' && !msg.isGroup) return false;
      if (type === 'contact' && (msg.isGroup || msg.isNewsletter)) return false;
      if (type === 'newsletter' && !msg.isNewsletter) return false;
      return true;
    });

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => b.timestamp - a.timestamp);

    return filtered.slice(0, limit);
  }

  /**
   * Get unread messages grouped by chat
   */
  getUnreadPerChat(
    instanceId: string,
    windowMs = 3600000,
    limit = 20,
  ): DiscoverChatEntry[] {
    const buffer = this.buffers.get(instanceId) || [];
    const cutoff = Date.now() - windowMs;

    // Group by chatId, take newest message per chat
    const latestPerChat = new Map<string, DiscoverChatEntry>();
    for (const msg of buffer) {
      if (msg.fromMe) continue;
      if (msg.timestamp * 1000 < cutoff) continue;
      if (!latestPerChat.has(msg.chatId)) {
        latestPerChat.set(msg.chatId, { ...msg, unreadCount: 1 });
      } else {
        const existing = latestPerChat.get(msg.chatId)!;
        existing.unreadCount++;
      }
    }

    return Array.from(latestPerChat.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Clear buffer for an instance (e.g., on instance removal)
   */
  clearInstance(instanceId: string): void {
    this.buffers.delete(instanceId);
    discoverLogger.info({ instanceId }, 'Discover buffer cleared');
  }
}

export const discoverService = new DiscoverService();
