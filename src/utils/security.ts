import crypto from 'crypto';

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export function constantTimeEquals(a: string, b: string): boolean {
  const buffA = Buffer.from(a);
  const buffB = Buffer.from(b);
  if (buffA.length !== buffB.length) return false;
  return crypto.timingSafeEqual(buffA, buffB);
}

export function createSignedValue(payload: Record<string, unknown>, secret: string): string {
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64'),
  );
  return `${encodedPayload}.${signature}`;
}

export function verifySignedValue<T>(
  token: string,
  secret: string,
): { valid: boolean; payload?: T } {
  const [encodedPayload, signature] = String(token || '').split('.');
  if (!encodedPayload || !signature) return { valid: false };

  const expectedSig = toBase64Url(
    crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64'),
  );
  if (!constantTimeEquals(signature, expectedSig)) {
    return { valid: false };
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as T;
    return { valid: true, payload };
  } catch {
    return { valid: false };
  }
}

export function createAdminSessionToken(secret: string, ttlMs: number): string {
  const now = Date.now();
  return createSignedValue(
    {
      scope: 'admin',
      iat: now,
      exp: now + ttlMs,
    },
    secret,
  );
}

export function verifyAdminSessionToken(token: string, secret: string): boolean {
  const result = verifySignedValue<{ scope: string; exp: number }>(token, secret);
  if (!result.valid || !result.payload) return false;
  if (result.payload.scope !== 'admin') return false;
  return result.payload.exp > Date.now();
}

export function createResourceSignature(resource: string, exp: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${resource}:${exp}`).digest('hex');
}

export function verifyResourceSignature(
  resource: string,
  exp: number,
  sig: string,
  secret: string,
): boolean {
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = createResourceSignature(resource, exp, secret);
  return constantTimeEquals(sig, expected);
}

