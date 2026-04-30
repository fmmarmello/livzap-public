const INSTANCE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const CHAT_ID_REGEX = /^[0-9A-Za-z._-]+@(c\.us|g\.us|newsletter)$/;
const NEWSLETTER_ID_REGEX = /^[0-9A-Za-z._-]{6,64}(@newsletter)?$/;

export function isValidInstanceId(value: string): boolean {
  if (!value) return false;
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false;
  return INSTANCE_ID_REGEX.test(value);
}

export function assertValidInstanceId(value: string): string {
  const trimmed = String(value || '').trim();
  if (!isValidInstanceId(trimmed)) {
    throw new Error(
      'Invalid instanceId. Use 3-64 chars: letters, numbers, underscore, hyphen. No slashes.',
    );
  }
  return trimmed;
}

export function isValidChatId(value: string): boolean {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.length > 128) return false;
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return false;
  return CHAT_ID_REGEX.test(trimmed);
}

export function assertValidChatId(value: string): string {
  const trimmed = String(value || '').trim();
  if (!isValidChatId(trimmed)) {
    throw new Error('Invalid chatId. Expected format ending with @c.us, @g.us, or @newsletter.');
  }
  return trimmed;
}

export function normalizeNewsletterId(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new Error('Invalid newsletterId');
  }
  if (!NEWSLETTER_ID_REGEX.test(trimmed)) {
    throw new Error('Invalid newsletterId');
  }
  return trimmed.includes('@') ? trimmed : `${trimmed}@newsletter`;
}

export function parseIntWithBounds(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

export function parseCsv(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function assertStrongApiKey(key: string): void {
  const trimmed = String(key || '').trim();
  if (trimmed.length < 24) {
    throw new Error('API_KEY must be at least 24 characters');
  }
  const banned = [
    'change-this',
    'changeme',
    'replace-with',
    'your-strong-key',
    'random-secret',
    'min-24chars',
    'livzap-change-me',
    'test',
    '12345',
  ];
  if (banned.some((word) => trimmed.toLowerCase().includes(word))) {
    throw new Error('API_KEY is too weak or default-like');
  }
}
