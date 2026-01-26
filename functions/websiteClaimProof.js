import crypto from 'crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export const WEBSITE_CLAIM_PATH = '/.well-known/artes-claim.txt';

export const normalizeDomain = (urlOrDomain) => {
  const raw = String(urlOrDomain ?? '').trim().toLowerCase();
  if (!raw) return '';
  const withProtocol = raw.includes('://') ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    return parsed.hostname.replace(/^www\./, '');
  } catch (error) {
    return raw.replace(/^www\./, '').split('/')[0];
  }
};

export const buildWebsiteClaimUrl = (domain) => `https://${domain}${WEBSITE_CLAIM_PATH}`;

export const hashWebsiteProofToken = (token) => (
  crypto.createHash('sha256').update(String(token ?? '')).digest('hex')
);

const isPrivateIpv4 = (address) => {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51) return true;
  if (a === 203 && b === 0) return true;
  return false;
};

const isPrivateIpv6 = (address) => {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.replace('::ffff:', '');
    if (net.isIP(v4) === 4) return isPrivateIpv4(v4);
  }
  return false;
};

export const isPrivateIpAddress = (address) => {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) return isPrivateIpv4(address);
  if (ipVersion === 6) return isPrivateIpv6(address);
  return false;
};

export const isSafeRedirectTarget = ({ baseHostname, targetUrl }) => {
  if (!targetUrl || targetUrl.protocol !== 'https:') return false;
  if (targetUrl.hostname !== baseHostname) return false;
  if (targetUrl.port && targetUrl.port !== '443') return false;
  return true;
};

const readResponseTextWithLimit = async (response, maxBytes) => {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new Error('Response too large');
    }
    return buffer.toString('utf-8');
  }
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error('Response too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
};

const ensureHostnameResolvesPublicly = async (hostname) => {
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) {
    throw new Error('No DNS records found');
  }
  const blocked = addresses.some((entry) => isPrivateIpAddress(entry.address));
  if (blocked) {
    throw new Error('Blocked IP address');
  }
};

export const fetchWebsiteClaimText = async ({
  hostname,
  url,
  timeoutMs = 8000,
  maxBytes = 8192,
  maxRedirects = 2,
}) => {
  let currentUrl = new URL(url);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    if (currentUrl.protocol !== 'https:') {
      throw new Error('Only https is allowed');
    }
    if (currentUrl.hostname !== hostname) {
      throw new Error('Hostname mismatch');
    }
    if (currentUrl.port && currentUrl.port !== '443') {
      throw new Error('Unsupported port');
    }
    await ensureHostnameResolvesPublicly(currentUrl.hostname);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(currentUrl.toString(), { redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Redirect without location');
      }
      if (redirectCount === maxRedirects) {
        throw new Error('Too many redirects');
      }
      const nextUrl = new URL(location, currentUrl);
      if (!isSafeRedirectTarget({ baseHostname: hostname, targetUrl: nextUrl })) {
        throw new Error('Unsafe redirect');
      }
      currentUrl = nextUrl;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Unexpected response ${response.status}`);
    }
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number.parseInt(contentLength, 10) > maxBytes) {
      throw new Error('Response too large');
    }
    return await readResponseTextWithLimit(response, maxBytes);
  }
  throw new Error('Unable to fetch claim proof');
};

export const checkWebsiteClaimToken = ({
  tokenHash,
  tokenExpiresAtMs,
  responseBody,
  now = Date.now(),
}) => {
  if (!tokenHash) return { ok: false, reason: 'missing-hash' };
  const trimmed = String(responseBody ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'missing-body' };
  const matches = hashWebsiteProofToken(trimmed) === tokenHash;
  if (!matches) return { ok: false, reason: 'mismatch' };
  if (typeof tokenExpiresAtMs === 'number' && tokenExpiresAtMs < now) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true };
};
