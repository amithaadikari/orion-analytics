import 'server-only';

import { isIP } from 'node:net';

export function approvedProductDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const allowedHosts = configuredProductDownloadHosts();
    if (!allowedHosts.size || !allowedHosts.has(hostname)) return null;
    const ipVersion = isIP(hostname);
    if ((!ipVersion && !hostname.includes('.')) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return null;
    if (ipVersion === 4 && isPrivateIpv4(hostname)) return null;
    if (ipVersion === 6 && isPrivateIpv6(hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function configuredProductDownloadHosts() {
  return new Set((process.env.PRODUCT_DOWNLOAD_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean));
}

function isPrivateIpv4(hostname: string) {
  const [a, b] = hostname.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateIpv6(hostname: string) {
  const value = hostname.toLowerCase();
  return value === '::' || value === '::1' || value.startsWith('::ffff:') || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff') || value.startsWith('2001:db8');
}
