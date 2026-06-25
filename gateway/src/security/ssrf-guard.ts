/**
 * SSRF guard for outbound fetches (research gate, video-research, any future
 * server-side URL fetch). Resolves a URL's hostname to its IP address(es) and
 * rejects private/loopback/link-local/CGNAT/metadata targets — so a public-
 * looking name (or an allowlisted host) cannot be used to reach the LAN, the
 * loopback interface, or a cloud metadata endpoint (169.254.169.254).
 *
 * This is defence in depth, not a perfect rebinding shield: the connection is
 * still made by name (a TOCTOU rebind between this check and connect is
 * possible). It closes the practical cases — IP literals in internal ranges,
 * names that resolve to internal IPs, IPv4-mapped IPv6, and decimal/hex IPv4
 * encodings — and is re-run on every redirect hop by callers.
 */
import { lookup } from 'dns/promises';

/** True for an IP literal in a private/loopback/link-local/CGNAT/unspecified range. */
export function isPrivateIp(ip: string): boolean {
  const s = ip.toLowerCase().trim();

  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]), b = Number(v4[2]);
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true; // malformed → treat as unsafe
    if (a === 0) return true;                          // 0.0.0.0/8 (routes to localhost)
    if (a === 10) return true;                         // 10/8
    if (a === 127) return true;                        // 127/8 loopback
    if (a === 169 && b === 254) return true;           // 169.254/16 link-local (incl. metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16/12
    if (a === 192 && b === 168) return true;           // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
    return false;
  }

  if (s === '::1' || s === '::') return true;                       // loopback / unspecified
  // IPv4-mapped IPv6 dotted form (::ffff:127.0.0.1) — re-check the embedded v4.
  const mapped = s.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPrivateIp(mapped[1]);
  // IPv4-mapped IPv6 hex form (::ffff:7f00:1) — new URL() normalizes the dotted
  // form to this, so decode the two 16-bit groups back to a.b.c.d and re-check.
  const mappedHex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    return isPrivateIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
  }
  // IPv4-compatible IPv6 dotted form (::127.0.0.1) — re-check the embedded v4.
  const compatDotted = s.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (compatDotted) return isPrivateIp(compatDotted[1]);
  // IPv4-compatible IPv6 hex form (::7f00:1) — new URL() normalizes the dotted
  // form to this; decode the two 16-bit groups back to a.b.c.d and re-check.
  // (Excludes the bare loopback/unspecified handled above.)
  const compatHex = s.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (compatHex) {
    const hi = parseInt(compatHex[1], 16), lo = parseInt(compatHex[2], 16);
    return isPrivateIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
  }
  // NAT64 (64:ff9b::a.b.c.d or 64:ff9b::xxxx:yyyy) — the well-known prefix
  // embeds a v4 address in its low 32 bits; decode and re-check it.
  const nat64Dotted = s.match(/^64:ff9b::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (nat64Dotted) return isPrivateIp(nat64Dotted[1]);
  const nat64Hex = s.match(/^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (nat64Hex) {
    const hi = parseInt(nat64Hex[1], 16), lo = parseInt(nat64Hex[2], 16);
    return isPrivateIp(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
  }
  if (s.includes(':')) {
    if (s.startsWith('fc') || s.startsWith('fd')) return true;      // fc00::/7 ULA
    if (s.startsWith('fe8') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return true; // fe80::/10
  }
  return false;
}

/**
 * Validate a URL is safe to fetch from the server. Allows only http/https,
 * rejects numeric/encoded host forms, and rejects any host that is — or resolves
 * to — a private/internal address.
 */
export async function assertPublicUrl(rawUrl: string): Promise<{ ok: boolean; reason?: string }> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { ok: false, reason: 'invalid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `protocol not allowed: ${u.protocol}` };
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (!host) return { ok: false, reason: 'missing host' };

  // Reject non-dotted IPv4 encodings (decimal e.g. 2130706433, hex 0x7f000001),
  // which bypass dotted-quad classification and can encode internal addresses.
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    return { ok: false, reason: 'numeric host encoding not allowed' };
  }

  if (isPrivateIp(host)) return { ok: false, reason: `private/internal address: ${host}` };

  // If it is already a dotted IPv4/IPv6 literal that passed the private check, allow it.
  const isLiteral = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
  if (isLiteral) return { ok: true };

  // Otherwise resolve the name and reject if ANY resolved address is internal.
  let addrs: Array<{ address: string }>;
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: `DNS resolution failed for ${host}` };
  }
  if (addrs.length === 0) return { ok: false, reason: `no addresses for ${host}` };
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      return { ok: false, reason: `${host} resolves to a private/internal address (${a.address})` };
    }
  }
  return { ok: true };
}
