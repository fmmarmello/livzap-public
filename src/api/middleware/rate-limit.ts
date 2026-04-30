import { Request, Response, NextFunction } from 'express';
import { settingsService } from '../../services/settings.service';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function getClientKey(req: Request): string {
  const key = (req.headers['x-api-key'] as string) || '';
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return key ? `key:${key}` : `ip:${ip}`;
}

function consume(windowMs: number, maxRequests: number, key: string): { allowed: boolean; retrySec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retrySec: Math.ceil(windowMs / 1000) };
  }

  if (bucket.count >= maxRequests) {
    return { allowed: false, retrySec: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, retrySec: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function globalRateLimit(req: Request, res: Response, next: NextFunction): void {
  const settings = settingsService.get().rateLimit;
  const key = `global:${getClientKey(req)}`;
  const result = consume(settings.windowMs, settings.maxRequests, key);
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retrySec.toString());
    res.status(429).json({ error: 'Too many requests' });
    return;
  }
  next();
}

export function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const settings = settingsService.get().rateLimit;
  const key = `auth:${getClientKey(req)}`;
  const result = consume(settings.authWindowMs, settings.authMaxRequests, key);
  if (!result.allowed) {
    res.setHeader('Retry-After', result.retrySec.toString());
    res.status(429).json({ error: 'Too many authentication attempts' });
    return;
  }
  next();
}

