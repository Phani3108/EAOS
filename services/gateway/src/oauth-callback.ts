/**
 * OAuth Callback Handler — Exchange authorization codes for access tokens.
 *
 * Flow:
 *   1. User clicks "Connect" in the UI → redirected to vendor authorize URL.
 *   2. Vendor redirects back to /api/tools/:toolId/oauth/callback?code=xxx.
 *   3. This module exchanges the code for a token via vendor token endpoint.
 *   4. Token is persisted via storeOAuthToken() in marketing-tool-connections.
 *   5. User is redirected to the frontend ConnectionsHub with a success flash.
 *
 * Currently wires: Slack, Google (Drive), HubSpot, LinkedIn, Salesforce.
 * Other vendors fall through to a helpful error page.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { storeOAuthToken } from './marketing-tool-connections.js';

export interface OAuthExchangeResult {
  success: boolean;
  error?: string;
  accountName?: string;
}

interface VendorConfig {
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  /** Extract a human-readable account name from the token response (optional). */
  extractAccount?: (data: Record<string, unknown>) => string | undefined;
  /** Extra form params to send with token exchange. */
  extraParams?: Record<string, string>;
}

const VENDOR_CONFIGS: Record<string, VendorConfig> = {
  slack: {
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    clientIdEnv: 'SLACK_CLIENT_ID',
    clientSecretEnv: 'SLACK_CLIENT_SECRET',
    extractAccount: (d) => {
      const team = d.team as { name?: string } | undefined;
      return team?.name;
    },
  },
  gdrive: {
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
  },
  hubspot: {
    tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
    clientIdEnv: 'HUBSPOT_CLIENT_ID',
    clientSecretEnv: 'HUBSPOT_CLIENT_SECRET',
  },
  'linkedin-ads': {
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    clientIdEnv: 'LINKEDIN_CLIENT_ID',
    clientSecretEnv: 'LINKEDIN_CLIENT_SECRET',
  },
  salesforce: {
    tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
    clientIdEnv: 'SALESFORCE_CLIENT_ID',
    clientSecretEnv: 'SALESFORCE_CLIENT_SECRET',
  },
};

/**
 * Exchange an OAuth authorization code for an access token and persist it.
 * Returns success=true when the token has been stored; success=false with a
 * human-readable error otherwise.
 */
export async function exchangeOAuthCode(
  toolId: string,
  code: string,
  redirectUri: string,
): Promise<OAuthExchangeResult> {
  const cfg = VENDOR_CONFIGS[toolId];
  if (!cfg) {
    return { success: false, error: `OAuth token exchange not wired for tool '${toolId}'` };
  }

  const clientId = process.env[cfg.clientIdEnv];
  const clientSecret = process.env[cfg.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return {
      success: false,
      error: `Missing env: ${cfg.clientIdEnv} and/or ${cfg.clientSecretEnv} must be set on the gateway`,
    };
  }

  const formBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    ...(cfg.extraParams ?? {}),
  });

  try {
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formBody.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Token exchange failed (${res.status}): ${text.slice(0, 300)}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    // Slack wraps success in data.ok
    if (toolId === 'slack' && data.ok === false) {
      return { success: false, error: `Slack token exchange error: ${String(data.error)}` };
    }
    const accessToken = (data.access_token as string) ?? (toolId === 'slack' ? (data.authed_user as { access_token?: string })?.access_token : undefined);
    if (!accessToken) {
      return { success: false, error: 'Response did not include access_token' };
    }
    const refreshToken = data.refresh_token as string | undefined;
    const accountName = cfg.extractAccount?.(data);

    storeOAuthToken(toolId, accessToken, accountName, refreshToken);
    return { success: true, accountName };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Small HTML helper for the callback response. Closes the popup if one was
 * used, otherwise redirects to the ConnectionsHub with a success/error flash.
 */
export function renderOAuthResultHtml(toolId: string, success: boolean, message?: string): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const js = (value: string | boolean) => JSON.stringify(value).replace(/</g, '\\u003c');
  const origin = new URL(process.env.FRONTEND_URL ?? 'http://localhost:3010').origin;
  const safeMsg = escape(message ?? '');
  const title = escape(success ? `${toolId} connected` : `${toolId} connection failed`);
  const color = success ? '#16a34a' : '#dc2626';
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Helvetica, sans-serif; padding: 40px; max-width: 640px; margin: 0 auto; }
  h1 { color: ${color}; }
  .msg { background: #f3f4f6; padding: 12px 16px; border-radius: 8px; font-family: monospace; font-size: 13px; word-break: break-word; }
  a { display: inline-block; margin-top: 24px; padding: 8px 16px; background: #111827; color: white; text-decoration: none; border-radius: 6px; }
</style>
</head>
<body>
  <h1>${title}</h1>
  ${safeMsg ? `<div class="msg">${safeMsg}</div>` : ''}
  <a href="${origin}/conn-ai-models">Back to Connections</a>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'oauth-result', toolId: ${js(toolId)}, success: ${js(success)}, message: ${js(message ?? '')} }, ${js(origin)});
        setTimeout(() => window.close(), 1500);
      }
    } catch (e) { /* ignore */ }
  </script>
</body>
</html>`;
}
