import dns from 'dns/promises';
import net from 'net';

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number.parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  const ranges: Array<[number, number]> = [
    [ipv4ToInt('10.0.0.0'), ipv4ToInt('10.255.255.255')],
    [ipv4ToInt('127.0.0.0'), ipv4ToInt('127.255.255.255')],
    [ipv4ToInt('169.254.0.0'), ipv4ToInt('169.254.255.255')],
    [ipv4ToInt('172.16.0.0'), ipv4ToInt('172.31.255.255')],
    [ipv4ToInt('192.168.0.0'), ipv4ToInt('192.168.255.255')],
    [ipv4ToInt('0.0.0.0'), ipv4ToInt('0.255.255.255')],
    [ipv4ToInt('100.64.0.0'), ipv4ToInt('100.127.255.255')],
  ];

  return ranges.some(([start, end]) => value >= start && value <= end);
}

function isUnsafeIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique local
  if (normalized.startsWith('fe80:')) return true; // link-local
  return false;
}

function isUnsafeIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isUnsafeIPv6(ip);
  return true;
}

export async function assertSafeRemoteHttpsUrl(
  urlString: string,
  allowlistDomains: string[],
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid media URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only HTTPS media URLs are allowed');
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost media URLs are blocked');
  }

  if (allowlistDomains.length > 0) {
    const allowed = allowlistDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (!allowed) {
      throw new Error('Media URL domain not allowed');
    }
  }

  const dnsResults = await dns.lookup(hostname, { all: true });
  if (dnsResults.length === 0) {
    throw new Error('Media URL host resolution failed');
  }

  if (dnsResults.some((entry) => isUnsafeIp(entry.address))) {
    throw new Error('Media URL resolved to private or blocked address');
  }

  return url;
}

