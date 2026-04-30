import { Request, Response, NextFunction } from 'express';
import { settingsService } from '../../services/settings.service';
import {
  createAdminSessionToken,
  createResourceSignature,
  verifyAdminSessionToken,
  verifyResourceSignature,
} from '../../utils/security';
import { authRateLimit } from './rate-limit';

function getApiKey(): string {
  return settingsService.get().security.apiKey;
}

function readApiKey(req: Request): string {
  const fromHeader = (req.headers['x-api-key'] as string) || '';
  if (fromHeader) return fromHeader;
  const auth = (req.headers.authorization as string) || '';
  if (auth.startsWith('ApiKey ')) return auth.slice('ApiKey '.length).trim();
  return '';
}

export function requireApiKey(_req: Request, res: Response, next: NextFunction) {
  authRateLimit(_req, res, () => {
    const expected = getApiKey();
    if (!expected) {
      res.status(503).json({ error: 'API key not configured' });
      return;
    }

    const key = readApiKey(_req);
    if (!key || key !== expected) {
      res.status(401).json({ error: 'Invalid or missing API key' });
      return;
    }
    next();
  });
}

export function issueAdminToken(): { token: string; expiresInMs: number } {
  const security = settingsService.get().security;
  const secret = security.apiKey + security.signedUrlSecret;
  const token = createAdminSessionToken(secret, security.adminSessionTtlMs);
  return { token, expiresInMs: security.adminSessionTtlMs };
}

function readBearerToken(req: Request): string {
  const auth = (req.headers.authorization as string) || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice('Bearer '.length).trim();
}

export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  const security = settingsService.get().security;
  if (!security.apiKey) {
    res.status(503).json({ error: 'Admin auth unavailable: API key not configured' });
    return;
  }
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing admin session token' });
    return;
  }
  const valid = verifyAdminSessionToken(token, security.apiKey + security.signedUrlSecret);
  if (!valid) {
    res.status(401).json({ error: 'Invalid or expired admin session token' });
    return;
  }
  next();
}

export function buildSignedResourceQuery(resource: string, ttlSec?: number): { exp: number; sig: string } {
  const security = settingsService.get().security;
  const expiresSec = ttlSec ?? security.signedUrlTtlSec;
  const exp = Date.now() + expiresSec * 1000;
  const sig = createResourceSignature(resource, exp, security.signedUrlSecret || security.apiKey);
  return { exp, sig };
}

function hasValidSignedResource(req: Request, resource: string): boolean {
  const security = settingsService.get().security;
  const exp = Number.parseInt(String(req.query.exp || ''), 10);
  const sig = String(req.query.sig || '');
  if (!Number.isFinite(exp) || !sig) return false;
  return verifyResourceSignature(resource, exp, sig, security.signedUrlSecret || security.apiKey);
}

export function requireApiKeyOrSignedResource(resourceFactory: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = getApiKey();
    const security = settingsService.get().security;
    const key = readApiKey(req);
    if (expected && key === expected) {
      next();
      return;
    }

    if (!expected && !security.signedUrlSecret) {
      res.status(503).json({ error: 'Authentication unavailable: API key not configured' });
      return;
    }

    const resource = resourceFactory(req);
    if (hasValidSignedResource(req, resource)) {
      next();
      return;
    }

    res.status(401).json({ error: 'Unauthorized access to protected resource' });
  };
}
