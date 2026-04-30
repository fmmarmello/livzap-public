import { Message, MessageMedia } from 'whatsapp-web.js';
import { writeFile, mkdir, unlink, stat, readdir } from 'fs/promises';
import { join, basename } from 'path';
import crypto from 'crypto';
import { whatsappLogger } from '../utils/logger';
import { settingsService } from './settings.service';
import { createResourceSignature } from '../utils/security';

export class MediaService {
  private readonly mediaDir: string;

  constructor(dir?: string) {
    this.mediaDir = dir || join(process.cwd(), 'temp', 'media');
    void this.ensureDir();
  }

  private async ensureDir() {
    try {
      await mkdir(this.mediaDir, { recursive: true });
    } catch (err) {
      whatsappLogger.error({ err }, 'Failed to create media directory');
    }
  }

  async downloadMedia(msg: Message): Promise<string | null> {
    try {
      if (!msg.hasMedia) return null;

      const media = await msg.downloadMedia();
      if (!media?.data) {
        whatsappLogger.warn({ msgId: msg.id.id }, 'Empty media received');
        return null;
      }

      const buffer = Buffer.from(media.data, 'base64');
      const extension = media.mimetype.split('/')[1]?.split(';')[0] || 'bin';
      const hash = crypto.createHash('md5').update(buffer).digest('hex');
      const filename = `${hash}.${extension}`;
      const filepath = join(this.mediaDir, filename);

      await writeFile(filepath, buffer);

      whatsappLogger.info({ msgId: msg.id.id, filepath, size: buffer.length }, 'Media downloaded');
      return filepath;
    } catch (err) {
      whatsappLogger.error({ err, msgId: msg.id?.id }, 'Failed to download media');
      return null;
    }
  }

  async getPublicUrl(localPath: string, baseUrl = ''): Promise<string> {
    const filename = basename(localPath);
    const security = settingsService.get().security;
    const exp = Date.now() + security.signedUrlTtlSec * 1000;
    const sig = createResourceSignature(
      `media:${filename}`,
      exp,
      security.signedUrlSecret || security.apiKey,
    );
    return `${baseUrl}/api/media/${filename}?exp=${exp}&sig=${sig}`;
  }

  async deleteMedia(localPath: string): Promise<void> {
    try {
      await unlink(localPath);
    } catch {
      // ignore
    }
  }

  hasMedia(msg: Message): boolean {
    return msg.hasMedia;
  }

  async cleanupOlderThan(days: number): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let deleted = 0;

    try {
      const files = await readdir(this.mediaDir);
      for (const file of files) {
        const filepath = join(this.mediaDir, file);
        const s = await stat(filepath);
        if (s.mtimeMs < cutoff) {
          await unlink(filepath);
          deleted++;
        }
      }
    } catch {
      // ignore
    }

    return deleted;
  }
}

export const mediaService = new MediaService();
