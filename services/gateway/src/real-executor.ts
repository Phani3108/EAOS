/**
 * Real Executor — Dispatches MCP actions to real vendor connectors when
 * env credentials are available; returns null to let the simulation path run
 * otherwise. This is the bridge between `mcp-executor.ts` and the connector
 * libraries in `connectors/{github,jira,slack}`.
 *
 * Design goal: minimize blast radius — if a connector throws, we log, return
 * null, and mcp-executor falls back to simulated output. A demo never breaks
 * just because a credential is wrong.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { GitHubConnector } from '@agentos/connector-github';
import { JiraConnector } from '@agentos/connector-jira';
import { SlackConnector } from '@agentos/connector-slack';

// ---------------------------------------------------------------------------
// Connector singletons — lazily initialized, memoized
// ---------------------------------------------------------------------------

let _github: GitHubConnector | null | undefined;
let _jira: JiraConnector | null | undefined;
let _slack: SlackConnector | null | undefined;

function github(): GitHubConnector | null {
  if (_github !== undefined) return _github;
  const token = process.env.GITHUB_TOKEN;
  const org = process.env.GITHUB_ORG;
  if (!token || !org) {
    _github = null;
    return null;
  }
  try {
    const c = new GitHubConnector(token, org);
    // Fire-and-forget connect; methods will throw if not connected, and we
    // catch below so falls back to simulation.
    c.connect().catch((err: Error) => console.warn('[real-executor] GitHub connect failed:', err.message));
    _github = c;
    return c;
  } catch (err) {
    console.warn('[real-executor] GitHub init failed:', (err as Error).message);
    _github = null;
    return null;
  }
}

function jira(): JiraConnector | null {
  if (_jira !== undefined) return _jira;
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) {
    _jira = null;
    return null;
  }
  try {
    _jira = new JiraConnector(baseUrl, email, token);
    return _jira;
  } catch (err) {
    console.warn('[real-executor] Jira init failed:', (err as Error).message);
    _jira = null;
    return null;
  }
}

function slack(): SlackConnector | null {
  if (_slack !== undefined) return _slack;
  const botToken = process.env.SLACK_BOT_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!botToken || !signingSecret) {
    _slack = null;
    return null;
  }
  try {
    _slack = new SlackConnector({
      botToken,
      signingSecret,
      appToken: process.env.SLACK_APP_TOKEN,
    });
    return _slack;
  } catch (err) {
    console.warn('[real-executor] Slack init failed:', (err as Error).message);
    _slack = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export interface RealExecRequest {
  tool_id: string;
  action: string;
  resource_type: string;
  params: Record<string, unknown>;
}

/**
 * Returns result record on success, null if no real connector is wired for
 * this (tool, action) pair — caller should fall back to simulation.
 *
 * Throws on real connector errors — caller can decide to surface the error
 * or fall back. Current caller (mcp-executor) surfaces via retry loop, which
 * is correct behavior for real calls.
 */
export async function tryRealExecute(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  switch (req.tool_id) {
    case 'github':
      return execGitHub(req);
    case 'jira':
      return execJira(req);
    case 'slack':
      return execSlack(req);
    case 'hubspot':
    case 'HubSpot':
      return execHubSpot(req);
    case 'linkedin':
    case 'linkedin-ads':
    case 'LinkedIn Ads':
      return execLinkedInAds(req);
    case 'canva':
    case 'Canva':
      return execCanva(req);
    case 'perplexity':
    case 'Perplexity':
      return execPerplexity(req);
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

async function execGitHub(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  const gh = github();
  if (!gh) return null;
  const p = req.params as Record<string, string | number>;

  switch (`${req.resource_type}:${req.action}`) {
    case 'issue:create':
      return { ...(await gh.createIssue(String(p.repo), String(p.title), String(p.body ?? ''), Array.isArray(p.labels) ? (p.labels as string[]) : undefined)), simulated: false };
    case 'issue:list':
      return { items: await gh.listIssues(String(p.repo), (p.state as 'open' | 'closed' | 'all') ?? 'open'), simulated: false };
    case 'issue:read':
      return { ...(await gh.getIssue(String(p.repo), Number(p.issue_number ?? p.number))), simulated: false };
    case 'pull_request:list':
      return { items: await gh.listPullRequests(String(p.repo), (p.state as 'open' | 'closed' | 'all') ?? 'open'), simulated: false };
    case 'pull_request:read':
      return { ...(await gh.getPullRequest(String(p.repo), Number(p.pr_number ?? p.number))), simulated: false };
    case 'pull_request:comment':
      await gh.commentOnPR(String(p.repo), Number(p.pr_number ?? p.number), String(p.body));
      return { commented: true, simulated: false };
    case 'repository:list':
      return { items: await gh.listRepos(), simulated: false };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

async function execJira(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  const j = jira();
  if (!j) return null;
  const p = req.params as Record<string, string | number>;

  switch (`${req.resource_type}:${req.action}`) {
    case 'issue:create':
      return { ...(await j.createIssue(String(p.project), String(p.issue_type ?? 'Task'), String(p.summary), p.description ? String(p.description) : undefined)), simulated: false };
    case 'issue:read':
      return { ...(await j.getIssue(String(p.issue_key ?? p.key))), simulated: false };
    case 'issue:update':
      await j.updateIssue(String(p.issue_key ?? p.key), (p.fields as unknown as Record<string, unknown>) ?? {});
      return { updated: true, simulated: false };
    case 'issue:comment':
      return { ...(await j.addComment(String(p.issue_key ?? p.key), String(p.body))), simulated: false };
    case 'issue:search':
      return { ...(await j.search(String(p.jql), Number(p.max_results ?? 20))), simulated: false };
    case 'project:list':
      return { items: await j.getProjects(), simulated: false };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

async function execSlack(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  const s = slack();
  if (!s) return null;
  const p = req.params as Record<string, string | number>;

  switch (`${req.resource_type}:${req.action}`) {
    case 'message:create':
      return { ...(await s.postMessage({ channel: String(p.channel), text: String(p.text) })), simulated: false };
    case 'channel:list':
      return { items: await s.getChannels(Number(p.limit ?? 200)), simulated: false };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// HubSpot — contacts, campaigns, emails
// Minimal thin-client: calls HubSpot v3 REST directly; no SDK dep needed.
// ---------------------------------------------------------------------------

async function hubspotFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown> | null> {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return null;
  const url = `https://api.hubapi.com${path}`;
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HubSpot ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function execHubSpot(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return null;
  const p = req.params as Record<string, unknown>;

  switch (`${req.resource_type}:${req.action}`) {
    case 'contact:create': {
      const out = await hubspotFetch('/crm/v3/objects/contacts', {
        method: 'POST',
        body: { properties: p.properties ?? p },
      });
      return { ...out, simulated: false };
    }
    case 'contact:list': {
      const limit = Number(p.limit ?? 20);
      const out = await hubspotFetch(`/crm/v3/objects/contacts?limit=${limit}`);
      return { ...out, simulated: false };
    }
    case 'email:create': {
      const out = await hubspotFetch('/marketing/v3/emails', {
        method: 'POST',
        body: p,
      });
      return { ...out, simulated: false };
    }
    case 'campaign:metrics': {
      const campaignId = String(p.campaign_id ?? p.id ?? '');
      if (!campaignId) throw new Error('campaign_id required');
      const out = await hubspotFetch(`/marketing/v3/campaigns/${campaignId}/metrics`);
      return { ...out, simulated: false };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// LinkedIn Ads — campaign management via Marketing Developer Platform
// ---------------------------------------------------------------------------

async function linkedinFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown> | null> {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.linkedin.com${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': process.env.LINKEDIN_API_VERSION ?? '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LinkedIn ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function execLinkedInAds(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  if (!process.env.LINKEDIN_ACCESS_TOKEN) return null;
  const p = req.params as Record<string, unknown>;

  switch (`${req.resource_type}:${req.action}`) {
    case 'campaign:create': {
      const out = await linkedinFetch('/rest/adCampaigns', {
        method: 'POST',
        body: p,
      });
      return { ...out, simulated: false };
    }
    case 'campaign:list': {
      const accountUrn = String(p.account_urn ?? process.env.LINKEDIN_AD_ACCOUNT_URN ?? '');
      const qs = accountUrn
        ? `?q=search&search.account.values[0]=${encodeURIComponent(accountUrn)}`
        : '';
      const out = await linkedinFetch(`/rest/adCampaigns${qs}`);
      return { ...out, simulated: false };
    }
    case 'creative:create': {
      const out = await linkedinFetch('/rest/adCreatives', {
        method: 'POST',
        body: p,
      });
      return { ...out, simulated: false };
    }
    case 'analytics:query': {
      const qs = new URLSearchParams(p as Record<string, string>).toString();
      const out = await linkedinFetch(`/rest/adAnalytics?${qs}`);
      return { ...out, simulated: false };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Canva — brief/asset creation via Canva Connect API
// ---------------------------------------------------------------------------

async function execCanva(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  const token = process.env.CANVA_ACCESS_TOKEN;
  if (!token) return null;
  const p = req.params as Record<string, unknown>;

  switch (`${req.resource_type}:${req.action}`) {
    case 'design:create': {
      const res = await fetch('https://api.canva.com/rest/v1/designs', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          design_type: { type: 'preset', name: String(p.design_type ?? 'doc') },
          asset_id: p.asset_id,
          title: p.title,
        }),
      });
      if (!res.ok) throw new Error(`Canva ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json() as Record<string, unknown>;
      return { ...data, simulated: false };
    }
    case 'export:create': {
      const res = await fetch('https://api.canva.com/rest/v1/exports', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(p),
      });
      if (!res.ok) throw new Error(`Canva ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json() as Record<string, unknown>;
      return { ...data, simulated: false };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Perplexity — research-grade LLM queries with citations
// ---------------------------------------------------------------------------

async function execPerplexity(req: RealExecRequest): Promise<Record<string, unknown> | null> {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;
  const p = req.params as Record<string, unknown>;
  const query = String(p.query ?? p.prompt ?? '');
  if (!query) throw new Error('Perplexity: query required');

  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: String(p.model ?? 'sonar-medium-online'),
      messages: [
        { role: 'system', content: String(p.system ?? 'Return a concise, well-cited research summary.') },
        { role: 'user', content: query },
      ],
      temperature: Number(p.temperature ?? 0.2),
      return_citations: true,
    }),
  });
  if (!res.ok) throw new Error(`Perplexity ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    citations?: string[];
  };
  return {
    answer: data.choices?.[0]?.message?.content ?? '',
    citations: data.citations ?? [],
    simulated: false,
  };
}

// ---------------------------------------------------------------------------
// Introspection — used by health checks, admin UI
// ---------------------------------------------------------------------------

export function realConnectorStatus(): Record<string, { enabled: boolean; reason?: string }> {
  return {
    github: github()
      ? { enabled: true }
      : { enabled: false, reason: 'GITHUB_TOKEN/GITHUB_ORG not set' },
    jira: jira()
      ? { enabled: true }
      : { enabled: false, reason: 'JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN not set' },
    slack: slack()
      ? { enabled: true }
      : { enabled: false, reason: 'SLACK_BOT_TOKEN/SLACK_SIGNING_SECRET not set' },
    hubspot: process.env.HUBSPOT_ACCESS_TOKEN
      ? { enabled: true }
      : { enabled: false, reason: 'HUBSPOT_ACCESS_TOKEN not set' },
    linkedin: process.env.LINKEDIN_ACCESS_TOKEN
      ? { enabled: true }
      : { enabled: false, reason: 'LINKEDIN_ACCESS_TOKEN not set' },
    canva: process.env.CANVA_ACCESS_TOKEN
      ? { enabled: true }
      : { enabled: false, reason: 'CANVA_ACCESS_TOKEN not set' },
    perplexity: process.env.PERPLEXITY_API_KEY
      ? { enabled: true }
      : { enabled: false, reason: 'PERPLEXITY_API_KEY not set' },
  };
}
