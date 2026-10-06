import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';

const blocked = new BlockList();
const blockedV6 = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::',128],['::1',128],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8],['2001:db8::',32],['2002::',16],['2001::',23]] as const) blockedV6.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
type Address = { address: string; family: number };
export async function validateDestination(target: string, origins: readonly string[], resolve = (host: string): Promise<Address[]> => lookup(host, { all: true }), privateOrigin?: string, signal?: AbortSignal): Promise<Address> {
  signal?.throwIfAborted();
  const url = new URL(target);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !origins.includes(url.origin)) throw new Error('Outbound origin is not authorized');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const resolution = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : resolve(host);
  const addresses = signal ? await new Promise<Address[]>((accept, reject) => {
    const abort = () => reject(new Error('Outbound resolution cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    resolution.then(accept, reject).finally(() => signal.removeEventListener('abort', abort));
  }) : await resolution;
  signal?.throwIfAborted();
  if (!addresses.length || addresses.length > 16) throw new Error('Outbound DNS result is invalid');
  for (const value of addresses) {
    const family = isIP(value.address);
    if (!family || family !== value.family || privateOrigin !== url.origin && ((family === 4 ? blocked : blockedV6).check(value.address, family === 4 ? 'ipv4' : 'ipv6') || family === 6 && !globalV6.check(value.address, 'ipv6'))) throw new Error('Outbound address is not public');
  }
  return addresses[0]!;
}
export interface JsonRequest { url: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH'; headers?: Record<string, string>; body?: unknown; signal?: AbortSignal }
export interface JsonReply { status: number; data: unknown }
export type JsonTransport = (request: JsonRequest) => Promise<JsonReply>;
export function createJsonTransport(origins: readonly string[], privateOrigin?: string): JsonTransport {
  return async input => {
    input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) };
    input.signal!.throwIfAborted();
    const url = new URL(input.url);
    const pinned = await validateDestination(input.url, origins, undefined, privateOrigin, input.signal);
    const body = input.body === undefined ? undefined : Buffer.from(JSON.stringify(input.body));
    if (body && body.length > 2_000_000) throw new Error('Outbound body is too large');
    return new Promise<JsonReply>((resolve, reject) => {
      const req = httpsRequest(url, { method: input.method, agent: false, family: pinned.family, lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family), signal: input.signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(body.length) } : {}), ...input.headers } }, response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 2_000_000) req.destroy(new Error('Outbound response is too large')); else chunks.push(chunk); });
        response.on('error', () => reject(new Error('Outbound response failed')));
        response.on('end', () => {
          const status = response.statusCode ?? 502;
          if (status >= 300 && status < 400) { reject(new Error('Outbound redirects are forbidden')); return; }
          try { const raw = Buffer.concat(chunks).toString('utf8'); resolve({ status, data: raw ? JSON.parse(raw) : null }); }
          catch { reject(new Error('Outbound response is not valid JSON')); }
        });
      });
      req.on('error', () => reject(input.signal?.aborted ? input.signal.reason : new Error('Outbound request failed')));
      req.end(body);
    });
  };
}
