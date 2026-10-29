import { describe, expect, it } from 'vitest';
import { resolveInitialSection } from './initial-section';

const known = new Set(['home', 'landing', 'ws-marketing', 'platform-chat']);
const resolve = (pathname: string, search = '', onboarded = false, ssoReturn: string | null = null) =>
  resolveInitialSection({ pathname, search, onboarded, isKnown: section => known.has(section), ssoReturn });

describe('initial section', () => {
  it('opens the app, not the landing page, when SSO returns with a login code', () => {
    // A first sign-in in a fresh browser: not onboarded. The code is exchanged
    // only inside the app shell and expires in 60 seconds.
    expect(resolve('/', '?login_code=fixture')).toBe('home');
    expect(resolve('/landing', '?login_code=fixture')).toBe('home');
  });

  it('returns to the section where SSO was started', () => {
    expect(resolve('/', '?login_code=fixture', false, 'ws-marketing')).toBe('ws-marketing');
    expect(resolve('/', '?login_code=fixture', false, 'landing')).toBe('home');
    expect(resolve('/', '?login_code=fixture', false, 'not-a-section')).toBe('home');
  });

  it('keeps the existing routing for everything else', () => {
    expect(resolve('/')).toBe('landing');
    expect(resolve('/', '', true)).toBe('home');
    expect(resolve('/landing', '', true)).toBe('home');
    expect(resolve('/unknown')).toBe('landing');
    expect(resolve('/platform-chat')).toBe('platform-chat');
    expect(resolve('/platform-chat', '?login_code=fixture')).toBe('platform-chat');
  });
});
