import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientAddress, isLoopbackAddress, localDemoVerdict, normalizeAddress, parseTrustedProxies, rateLimitSubject } from './request-origin.js';

const request = (peer: string, headers: Record<string, string> = {}) => ({ socket: { remoteAddress: peer }, headers: { host: 'localhost:3000', ...headers } });
const loopback = parseTrustedProxies('127.0.0.1,::1');
const nobody = parseTrustedProxies(undefined);

beforeEach(() => { vi.stubEnv('CORS_ALLOWED_ORIGINS', 'http://localhost:3010,http://127.0.0.1:3010'); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('addresses', () => {
  it('spells each address one way', () => {
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeAddress('[::1]')).toBe('::1');
    expect(normalizeAddress('fe80::1%en0')).toBe('fe80::1');
    expect(normalizeAddress('unknown')).toBeUndefined();
  });
  it('recognises loopback in both families', () => {
    for (const address of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(address)).toBe(true);
    for (const address of ['10.0.0.1', '192.168.1.20', '::', undefined]) expect(isLoopbackAddress(address)).toBe(false);
  });
  it('matches trusted proxies by address and CIDR block, and trusts nobody by default', () => {
    const trusted = parseTrustedProxies('10.0.0.0/8, fd00::/8, 192.168.1.5');
    expect(trusted.has('10.20.30.40')).toBe(true);
    expect(trusted.has('::ffff:10.1.1.1')).toBe(true);
    expect(trusted.has('fd12::1')).toBe(true);
    expect(trusted.has('192.168.1.5')).toBe(true);
    expect(trusted.has('192.168.1.6')).toBe(false);
    expect(nobody.has('127.0.0.1')).toBe(false);
    expect(parseTrustedProxies('web, 10.0.0.0/33').has('10.0.0.1')).toBe(false);
  });
});

describe('client attribution', () => {
  it('ignores X-Forwarded-For from a peer nobody trusted', () => {
    expect(clientAddress('203.0.113.9', '198.51.100.1', nobody)).toBe('203.0.113.9');
    expect(clientAddress('203.0.113.9', '127.0.0.1', loopback)).toBe('203.0.113.9');
  });
  it('takes the nearest untrusted hop behind a trusted proxy', () => {
    // The edge appended the address it saw; whatever is to its left is the client's own text.
    expect(clientAddress('127.0.0.1', '6.6.6.6, 198.51.100.7', loopback)).toBe('198.51.100.7');
    expect(clientAddress('10.0.0.3', '198.51.100.7, 10.0.0.2', parseTrustedProxies('10.0.0.0/8'))).toBe('198.51.100.7');
  });
  it('says nothing about a client that a trusted proxy did not name', () => {
    expect(clientAddress('127.0.0.1', undefined, loopback)).toBeUndefined();
    expect(clientAddress('127.0.0.1', 'unknown', loopback)).toBeUndefined();
  });
});

describe('unauthenticated rate-limit subject', () => {
  const session = `${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}.${'a'.repeat(64)}`;
  it('separates browsers behind a proxy that forwards client addresses', () => {
    const first = rateLimitSubject(request('127.0.0.1', { 'x-forwarded-for': '198.51.100.7' }), loopback);
    const second = rateLimitSubject(request('127.0.0.1', { 'x-forwarded-for': '198.51.100.8' }), loopback);
    expect(first).toBe('ip:198.51.100.7');
    expect(second).not.toBe(first);
  });
  it('falls back to the browser session behind a proxy that names no client', () => {
    const refreshing = rateLimitSubject(request('127.0.0.1', { cookie: `eaos_refresh=${session}` }), loopback);
    const signingIn = rateLimitSubject(request('127.0.0.1', { cookie: `eaos_login=${'b'.repeat(64)}` }), loopback);
    const anonymous = rateLimitSubject(request('127.0.0.1'), loopback);
    expect(refreshing).toMatch(/^session:/);
    expect(refreshing).not.toContain(session.split('.')[0]);
    expect(signingIn).toMatch(/^login:/);
    expect(anonymous).toBe('proxy:127.0.0.1');
    expect(new Set([refreshing, signingIn, anonymous]).size).toBe(3);
  });
  it('keys direct callers on their own address whatever they claim', () => {
    expect(rateLimitSubject(request('203.0.113.9', { 'x-forwarded-for': '198.51.100.1', cookie: `eaos_refresh=${session}` }), loopback)).toBe('ip:203.0.113.9');
  });
});

describe('local demo requests', () => {
  it('accepts the developer: loopback client, local host, allowed or absent Origin', () => {
    expect(localDemoVerdict(request('127.0.0.1'), loopback).allowed).toBe(true);
    expect(localDemoVerdict(request('::1', { host: '[::1]:3000', origin: 'http://localhost:3010' }), loopback).allowed).toBe(true);
    // The bundled web proxy: Host rewritten to the target, the browser's host forwarded.
    expect(localDemoVerdict(request('::ffff:127.0.0.1', { host: '127.0.0.1:3000', 'x-forwarded-host': 'localhost:3010', origin: 'http://localhost:3010' }), loopback).allowed).toBe(true);
    expect(localDemoVerdict(request('127.0.0.1', { host: 'eaos.localhost:3000' }), nobody).allowed).toBe(true);
  });
  it('refuses another machine on the network', () => {
    const verdict = localDemoVerdict(request('192.168.1.20', { host: '192.168.1.5:3000' }), loopback);
    expect(verdict.allowed).toBe(false);
    expect(localDemoVerdict(request('192.168.1.20'), loopback)).toEqual({ allowed: false, reason: 'the client is not on this machine' });
  });
  it('refuses a cross-site request from a page the developer has open', () => {
    const verdict = localDemoVerdict(request('127.0.0.1', { origin: 'https://attacker.example', 'content-type': 'text/plain' }), loopback);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).not.toContain('attacker.example');
    expect(localDemoVerdict(request('127.0.0.1', { origin: 'null' }), loopback).allowed).toBe(false);
  });
  it('refuses DNS rebinding, directly and through the web proxy', () => {
    expect(localDemoVerdict(request('127.0.0.1', { host: 'rebind.attacker.example:3000' }), loopback).allowed).toBe(false);
    expect(localDemoVerdict(request('127.0.0.1', { host: '127.0.0.1:3000', 'x-forwarded-host': 'rebind.attacker.example:3010' }), loopback).allowed).toBe(false);
    // A rebinding page can add X-Forwarded-Host; it cannot change Host.
    expect(localDemoVerdict(request('127.0.0.1', { host: 'rebind.attacker.example:3000', 'x-forwarded-host': 'localhost:3000' }), loopback).allowed).toBe(false);
    expect(localDemoVerdict({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }, loopback).allowed).toBe(false);
  });
  it('refuses a remote visitor relayed over loopback by a tunnel', () => {
    expect(localDemoVerdict(request('127.0.0.1', { 'x-forwarded-for': '198.51.100.7' }), loopback)).toEqual({ allowed: false, reason: 'the client is not on this machine' });
    // A relay that names its client unreadably vouches for nobody.
    expect(localDemoVerdict(request('127.0.0.1', { 'x-forwarded-for': 'unknown' }), loopback).allowed).toBe(false);
    // A local relay that names a local client is fine.
    expect(localDemoVerdict(request('127.0.0.1', { 'x-forwarded-for': '::1' }), loopback).allowed).toBe(true);
  });
});
