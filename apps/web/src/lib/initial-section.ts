/**
 * Which section the app opens on, from the URL it was loaded at.
 *
 * Organization SSO comes back to the web root with `?login_code=…`, and only
 * AuthGate — mounted inside the app shell, not on the landing page — exchanges
 * that code, which expires in 60 seconds. The root used to resolve to the landing
 * page for anyone who had not finished onboarding (every first sign-in in a fresh
 * browser), so the user was dropped on the marketing page with an unused code and
 * had to repeat SSO. A sign-in now always opens the app, at the section where SSO
 * was started when that is known.
 */
const SSO_RETURN_KEY = 'eaos_sso_return';

export interface InitialSectionInput {
  pathname: string;
  search: string;
  onboarded: boolean;
  isKnown: (section: string) => boolean;
  /** Section remembered when SSO started (rememberSsoReturn), if any. */
  ssoReturn?: string | null;
}

export function resolveInitialSection({ pathname, search, onboarded, isKnown, ssoReturn }: InitialSectionInput): string {
  const path = pathname.replace(/^\/+/, '');
  if (path !== 'landing' && isKnown(path)) return path;
  if (new URLSearchParams(search).has('login_code')) return ssoReturn && ssoReturn !== 'landing' && isKnown(ssoReturn) ? ssoReturn : 'home';
  // Returning users (completed onboarding) skip the Landing splash → straight to Home
  return onboarded ? 'home' : 'landing';
}

/** Remember where SSO was started, so the identity-provider round trip can land there. */
export function rememberSsoReturn(section: string): void {
  try { sessionStorage.setItem(SSO_RETURN_KEY, section); } catch { /* storage unavailable: land on home */ }
}

/** The section remembered by rememberSsoReturn, read once. */
export function takeSsoReturn(): string | null {
  try {
    const section = sessionStorage.getItem(SSO_RETURN_KEY);
    sessionStorage.removeItem(SSO_RETURN_KEY);
    return section;
  } catch {
    return null;
  }
}
