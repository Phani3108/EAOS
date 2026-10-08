/**
 * Who is on the other end of a request, as far as the gateway can honestly tell.
 *
 * Two decisions depend on it:
 *
 *  - The unauthenticated rate limit. It keyed on `req.socket.remoteAddress`, but
 *    browsers reach the gateway only through the web tier's `/_/gateway` rewrite,
 *    so every visitor arrived from the web server's address and each public auth
 *    path (config, demo, SSO callback, setup) was ONE 10-per-minute bucket for the
 *    whole deployment. The 11th visitor in a minute lost the "Try the demo"
 *    button, and one client could hold sign-in shut for everyone.
 *  - Local demo mode, where having no credential IS the credential: the request
 *    must come from the developer's own machine, not from another machine on the
 *    network or from a web page the developer happens to have open.
 *
 * X-Forwarded-For is client-supplied text, so it is honoured only from proxies the
 * operator lists in EAOS_TRUSTED_PROXIES — never inferred, never from anyone who
 * merely sends the header. Note that the bundled Next rewrite does not add the
 * header itself (its proxy runs without `xfwd`); it relays what the edge in front
 * of it set. That is why trust is per address and the walk below starts from the
 * right: the rightmost entry is the one the nearest trusted hop could vouch for.
 */
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import type { LocalDemoVerdict } from './auth.js';
import { readCookie } from './auth-sessions.js';
import { isAllowedBrowserOrigin } from './stream-access.js';

type RequestLike = Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string } };

export interface AddressMatcher {
  has(address: string | undefined): boolean;
}

/** One spelling per address: no brackets or zone, IPv4-mapped IPv6 as plain IPv4. */
export function normalizeAddress(address: string | undefined): string | undefined {
  let value = address?.trim() ?? '';
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  if (/^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(value)) value = value.slice(7);
  return isIP(value) ? value.toLowerCase() : undefined;
}

const family = (address: string) => (isIP(address) === 6 ? 'ipv6' : 'ipv4');

/**
 * EAOS_TRUSTED_PROXIES as a matcher. @agentos/config rejects malformed entries at
 * boot; one that slips through here is skipped, because trust must never widen on
 * an entry nobody can read.
 */
export function parseTrustedProxies(raw: string | undefined): AddressMatcher {
  const list = new BlockList();
  let entries = 0;
  for (const entry of (raw ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
    const [address, prefix, ...rest] = entry.split('/');
    const normalized = normalizeAddress(address);
    if (!normalized || rest.length) continue;
    if (prefix === undefined) {
      list.addAddress(normalized, family(normalized));
    } else {
      const bits = Number(prefix);
      if (!/^\d+$/.test(prefix) || bits > (family(normalized) === 'ipv6' ? 128 : 32)) continue;
      list.addSubnet(normalized, bits, family(normalized));
    }
    entries++;
  }
  return {
    has(address) {
      const normalized = normalizeAddress(address);
      return Boolean(entries && normalized && list.check(normalized, family(normalized)));
    },
  };
}

export function isLoopbackAddress(address: string | undefined): boolean {
  const normalized = normalizeAddress(address);
  return Boolean(normalized && (normalized === '::1' || (isIP(normalized) === 4 && normalized.startsWith('127.'))));
}

function header(req: RequestLike, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

/**
 * The client's address: the socket peer, or — when the peer is a trusted proxy —
 * the nearest untrusted hop in X-Forwarded-For, walking right to left past
 * trusted ones. Entries further left are whatever the client chose to send.
 *
 * `undefined` means a trusted proxy relayed the request without saying whose it
 * is (no header, or a hop that is not an address), so nothing behind it is known.
 */
export function clientAddress(peer: string | undefined, forwardedFor: string | undefined, trusted: AddressMatcher): string | undefined {
  const socket = normalizeAddress(peer);
  if (!socket || !trusted.has(socket)) return socket;
  const hops = (forwardedFor ?? '').split(',').map(hop => hop.trim()).filter(Boolean);
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = normalizeAddress(hops[index]);
    if (!hop) return undefined;
    if (!trusted.has(hop) || index === 0) return hop;
  }
  return undefined;
}

const SESSION_COOKIE = /^([a-f0-9-]{36})\.[a-f0-9]{64}$/;
const LOGIN_BINDING = /^[a-f0-9]{64}$/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 32);

/**
 * The rate-limit subject for a request with no authenticated principal.
 *
 * A trusted proxy that names no client is the bundled web tier with nothing in
 * front of it. Keying on the proxy would put every browser in one bucket again,
 * so the browser's own sign-in material is used where it has some: the refresh
 * session (token refresh) or the SSO login binding (callback, exchange). Those
 * values are client-held, so a client can mint itself fresh buckets — which costs
 * nobody else anything, unlike one shared bucket that any client can drain.
 * Paths that carry neither (config, demo, authorize, setup) share the proxy's
 * bucket until the edge in front of the web tier forwards client addresses.
 */
export function rateLimitSubject(req: RequestLike, trusted: AddressMatcher): string {
  const client = clientAddress(req.socket.remoteAddress, header(req, 'x-forwarded-for'), trusted);
  if (client) return `ip:${client}`;
  const session = SESSION_COOKIE.exec(readCookie(req as IncomingMessage, 'eaos_refresh'))?.[1];
  const binding = readCookie(req as IncomingMessage, 'eaos_login');
  if (session) return `session:${digest(session)}`;
  if (LOGIN_BINDING.test(binding)) return `login:${digest(binding)}`;
  return `proxy:${normalizeAddress(req.socket.remoteAddress) ?? 'unknown'}`;
}

/** A Host or X-Forwarded-Host entry naming this machine. Ports do not matter. */
function isLoopbackHost(value: string): boolean {
  const name = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::\d{1,5})?$/i.exec(value.trim())?.[1]?.toLowerCase();
  if (!name) return false;
  return name === 'localhost' || name.endsWith('.localhost') || isLoopbackAddress(name);
}

/**
 * Whether a credential-less request is the developer's own, for EAOS_DEMO_MODE=local.
 *
 *  - Origin: absent (curl, server-side calls, same-origin GETs) or an allowed
 *    browser origin. Browsers send Origin on every cross-site POST, simple
 *    text/plain ones included, so a page on another site cannot act as the local
 *    administrator.
 *  - Host, and X-Forwarded-Host when present: a loopback name. Same-origin GETs
 *    carry no Origin, so DNS rebinding (a hostile name re-pointed at 127.0.0.1)
 *    would read data with Origin alone; the browser still sends that hostile name
 *    as Host, and the Next proxy forwards it as X-Forwarded-Host.
 *  - Client: on this machine, as far as clientAddress can tell. A tunnel such as
 *    ngrok arrives over loopback but names its remote visitor in X-Forwarded-For.
 *
 * A process that can reach the port from this machine can satisfy all three by
 * construction; the boundary is the machine, which is why `pnpm dev` also binds
 * both servers to 127.0.0.1.
 */
export function localDemoVerdict(req: RequestLike, trusted: AddressMatcher): LocalDemoVerdict {
  const origin = header(req, 'origin');
  if (origin !== undefined && !isAllowedBrowserOrigin(origin)) {
    return { allowed: false, reason: 'the request comes from a browser origin that is not allowed' };
  }
  const hosts = [header(req, 'host') ?? '', ...(header(req, 'x-forwarded-host')?.split(',') ?? [])];
  if (!hosts.every(isLoopbackHost)) {
    return { allowed: false, reason: 'the request names a host other than this machine' };
  }
  // A trusted proxy that names no client (the bundled Next rewrite adds no
  // X-Forwarded-For) leaves the proxy itself as the best knowledge; one that sends
  // a hop that is not an address leaves nothing to vouch for, so that refuses.
  const forwarded = header(req, 'x-forwarded-for')?.trim();
  const client = clientAddress(req.socket.remoteAddress, forwarded, trusted) ?? (forwarded ? undefined : req.socket.remoteAddress);
  if (!isLoopbackAddress(client)) {
    return { allowed: false, reason: 'the client is not on this machine' };
  }
  return { allowed: true };
}
