'use client';

/**
 * Connections Store — global connection state for all integrations
 * Tracks connector status, credentials, and test results
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ConnectorAuthType = 'api-key' | 'oauth' | 'url-token' | 'credentials' | 'sandbox';

export type ConnectionStatus =
  | 'connected'
  | 'configured'
  | 'not-connected'
  | 'expired'
  | 'reauth-required'
  | 'partial'
  | 'error'
  | 'testing'
  | 'sandbox';

export interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  authType: ConnectorAuthType;
  icon: string;          // emoji or letter
  color: string;         // tailwind bg color class
  capabilities: string[];
  requiredFields: CredentialField[];
  docsUrl?: string;
  sandboxAvailable: boolean;
  personas?: string[];   // which personas use this tool
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'url';
  placeholder: string;
  required: boolean;
  hint?: string;
}

export type ConnectorCategory =
  | 'ai-models'
  | 'storage'
  | 'design'
  | 'crm-ads'
  | 'dev-tools'
  | 'cms'
  | 'messaging'
  | 'data';

export interface ConnectorState {
  connectorId: string;
  status: ConnectionStatus;
  connectedAt?: string;
  lastTestedAt?: string;
  expiresAt?: string;
  error?: string;
  displayName?: string;  // e.g. email/username of connected account
  scopes?: string[];
}

// ---------------------------------------------------------------------------
// Connector catalog
// ---------------------------------------------------------------------------

export const CONNECTOR_CATALOG: ConnectorDef[] = [
  // AI Models
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    description: 'Claude 3.5 Sonnet, Claude 3 Opus — world-class reasoning and generation.',
    category: 'ai-models',
    authType: 'api-key',
    icon: 'A',
    color: 'bg-orange-500',
    capabilities: ['text.generate', 'text.analyze', 'code.generate', 'image.analyze'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...', required: true, hint: 'Get from console.anthropic.com' },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product', 'marketing', 'hr'],
  },
  {
    id: 'openai',
    name: 'OpenAI GPT',
    description: 'GPT-4o, GPT-4 Turbo, o1 — versatile LLM for any task.',
    category: 'ai-models',
    authType: 'api-key',
    icon: '⊹',
    color: 'bg-emerald-600',
    capabilities: ['text.generate', 'code.generate', 'image.generate', 'image.analyze'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', required: true, hint: 'Get from platform.openai.com' },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product', 'marketing', 'hr'],
  },
  {
    id: 'azure-openai',
    name: 'Azure OpenAI',
    description: 'Enterprise OpenAI on Azure — data privacy, compliance, SLA.',
    category: 'ai-models',
    authType: 'url-token',
    icon: 'Az',
    color: 'bg-blue-600',
    capabilities: ['text.generate', 'code.generate'],
    requiredFields: [
      { key: 'endpoint', label: 'Endpoint URL', type: 'url', placeholder: 'https://your-resource.openai.azure.com', required: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'your-azure-key', required: true },
      { key: 'deploymentId', label: 'Deployment Name', type: 'text', placeholder: 'gpt-4o', required: true },
    ],
    sandboxAvailable: false,
    personas: ['engineering'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    description: 'Gemini 1.5 Pro and Flash — multimodal reasoning at scale.',
    category: 'ai-models',
    authType: 'api-key',
    icon: 'G',
    color: 'bg-blue-500',
    capabilities: ['text.generate', 'image.analyze', 'video.analyze'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'AIza...', required: true, hint: 'Get from aistudio.google.com' },
    ],
    sandboxAvailable: true,
    personas: ['product', 'marketing', 'hr'],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    description: 'Run Llama 3, Mistral, Phi-3 locally. Zero data leaves your machine.',
    category: 'ai-models',
    authType: 'url-token',
    icon: '🦙',
    color: 'bg-gray-700',
    capabilities: ['text.generate', 'code.generate'],
    requiredFields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', placeholder: 'http://localhost:11434', required: true },
      { key: 'model', label: 'Default Model', type: 'text', placeholder: 'llama3.2', required: true },
    ],
    sandboxAvailable: false,
    personas: ['engineering'],
  },

  // Storage & Docs
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Read, write, and search Docs, Sheets, and Slides.',
    category: 'storage',
    authType: 'oauth',
    icon: '▲',
    color: 'bg-yellow-500',
    capabilities: ['storage.read', 'storage.write', 'doc.create'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'ya29...', required: true, hint: 'Click Connect to authorize via OAuth' },
    ],
    sandboxAvailable: true,
    personas: ['marketing', 'product'],
  },
  {
    id: 'confluence',
    name: 'Confluence',
    description: 'Read and create Confluence pages, search knowledge base.',
    category: 'storage',
    authType: 'url-token',
    icon: 'C',
    color: 'bg-blue-700',
    capabilities: ['doc.read', 'doc.create', 'search.knowledge'],
    requiredFields: [
      { key: 'baseUrl', label: 'Confluence URL', type: 'url', placeholder: 'https://your-org.atlassian.net/wiki', required: true },
      { key: 'email', label: 'Email', type: 'text', placeholder: 'you@company.com', required: true },
      { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'your-atlassian-token', required: true, hint: 'Get from id.atlassian.com/manage-profile/security' },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product'],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Read and write Notion pages, databases, and wikis.',
    category: 'storage',
    authType: 'api-key',
    icon: 'N',
    color: 'bg-gray-900',
    capabilities: ['doc.read', 'doc.create', 'database.query'],
    requiredFields: [
      { key: 'apiKey', label: 'Integration Token', type: 'password', placeholder: 'secret_...', required: true, hint: 'Create at notion.so/my-integrations' },
    ],
    sandboxAvailable: true,
    personas: ['product', 'marketing', 'hr'],
  },

  // Design
  {
    id: 'figma',
    name: 'Figma',
    description: 'Read design files, export assets, inspect components.',
    category: 'design',
    authType: 'api-key',
    icon: 'F',
    color: 'bg-purple-600',
    capabilities: ['design.read', 'asset.export'],
    requiredFields: [
      { key: 'accessToken', label: 'Personal Access Token', type: 'password', placeholder: 'figd_...', required: true, hint: 'Get from Figma → Settings → Personal access tokens' },
    ],
    sandboxAvailable: false,
    personas: ['product', 'marketing'],
  },
  {
    id: 'canva',
    name: 'Canva',
    description: 'Create and export designs, presentations, and social assets.',
    category: 'design',
    authType: 'oauth',
    icon: 'Ca',
    color: 'bg-cyan-500',
    capabilities: ['design.create', 'design.export', 'template.use'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'OAuth token', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },

  // CRM & Ads
  {
    id: 'hubspot',
    name: 'HubSpot',
    description: 'Create contacts, deals, campaigns, and email sequences.',
    category: 'crm-ads',
    authType: 'api-key',
    icon: 'H',
    color: 'bg-orange-600',
    capabilities: ['crm.read', 'crm.write', 'email.send', 'campaign.create'],
    requiredFields: [
      { key: 'apiKey', label: 'Private App Token', type: 'password', placeholder: 'pat-na1-...', required: true, hint: 'Create at app.hubspot.com → Settings → Private Apps' },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    description: 'Read and write CRM records, run SOQL queries.',
    category: 'crm-ads',
    authType: 'oauth',
    icon: 'Sf',
    color: 'bg-blue-500',
    capabilities: ['crm.read', 'crm.write', 'report.run'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'OAuth token', required: true },
      { key: 'instanceUrl', label: 'Instance URL', type: 'url', placeholder: 'https://your-org.salesforce.com', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },
  {
    id: 'linkedin-ads',
    name: 'LinkedIn Ads',
    description: 'Create and manage LinkedIn ad campaigns, pull analytics.',
    category: 'crm-ads',
    authType: 'oauth',
    icon: 'Li',
    color: 'bg-blue-700',
    capabilities: ['ads.create', 'ads.manage', 'analytics.read'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'OAuth token', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },

  // Dev Tools
  {
    id: 'github',
    name: 'GitHub',
    description: 'Read PRs, create issues, run code search, post comments.',
    category: 'dev-tools',
    authType: 'api-key',
    icon: 'GH',
    color: 'bg-gray-900',
    capabilities: ['scm.read_pr', 'scm.create_issue', 'scm.search', 'scm.comment'],
    requiredFields: [
      { key: 'token', label: 'Personal Access Token', type: 'password', placeholder: 'ghp_...', required: true, hint: 'Create at github.com/settings/tokens (needs repo + read:org)' },
    ],
    sandboxAvailable: true,
    personas: ['engineering'],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Create epics, stories, search issues, update ticket status.',
    category: 'dev-tools',
    authType: 'url-token',
    icon: 'Ji',
    color: 'bg-blue-600',
    capabilities: ['pm.create_ticket', 'pm.read', 'pm.update'],
    requiredFields: [
      { key: 'baseUrl', label: 'Jira URL', type: 'url', placeholder: 'https://your-org.atlassian.net', required: true },
      { key: 'email', label: 'Email', type: 'text', placeholder: 'you@company.com', required: true },
      { key: 'apiToken', label: 'API Token', type: 'password', placeholder: 'your-atlassian-token', required: true },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product'],
  },
  {
    id: 'pagerduty',
    name: 'PagerDuty',
    description: 'Create and resolve incidents, read on-call schedules.',
    category: 'dev-tools',
    authType: 'api-key',
    icon: 'PD',
    color: 'bg-green-600',
    capabilities: ['incident.create', 'incident.resolve', 'oncall.read'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'your-pd-key', required: true },
    ],
    sandboxAvailable: true,
    personas: ['engineering'],
  },
  {
    id: 'datadog',
    name: 'Datadog',
    description: 'Query metrics, logs, and traces. Create monitors and dashboards.',
    category: 'dev-tools',
    authType: 'api-key',
    icon: 'DD',
    color: 'bg-purple-700',
    capabilities: ['metrics.query', 'logs.search', 'monitor.create'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'your-dd-api-key', required: true },
      { key: 'appKey', label: 'Application Key', type: 'password', placeholder: 'your-dd-app-key', required: true },
    ],
    sandboxAvailable: true,
    personas: ['engineering'],
  },

  // CMS & Publishing
  {
    id: 'webflow',
    name: 'Webflow',
    description: 'Publish CMS items, manage collections, update pages.',
    category: 'cms',
    authType: 'api-key',
    icon: 'W',
    color: 'bg-blue-500',
    capabilities: ['cms.publish', 'cms.create', 'cms.update'],
    requiredFields: [
      { key: 'apiKey', label: 'API Token', type: 'password', placeholder: 'your-webflow-token', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },
  {
    id: 'contentful',
    name: 'Contentful',
    description: 'Create and publish content entries, manage assets.',
    category: 'cms',
    authType: 'api-key',
    icon: 'Cf',
    color: 'bg-yellow-600',
    capabilities: ['cms.create', 'cms.publish', 'asset.upload'],
    requiredFields: [
      { key: 'spaceId', label: 'Space ID', type: 'text', placeholder: 'your-space-id', required: true },
      { key: 'apiKey', label: 'Management API Key', type: 'password', placeholder: 'your-cma-token', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },

  // Messaging
  {
    id: 'slack',
    name: 'Slack',
    description: 'Post messages, create channels, notify stakeholders.',
    category: 'messaging',
    authType: 'oauth',
    icon: '⟨S⟩',
    color: 'bg-purple-500',
    capabilities: ['message.send', 'channel.create', 'notification.push'],
    requiredFields: [
      { key: 'botToken', label: 'Bot OAuth Token', type: 'password', placeholder: 'xoxb-...', required: true, hint: 'Create a Slack App at api.slack.com/apps' },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product', 'marketing', 'hr'],
  },
  {
    id: 'ms-teams',
    name: 'Microsoft Teams',
    description: 'Send messages and adaptive cards to Teams channels.',
    category: 'messaging',
    authType: 'url-token',
    icon: 'T',
    color: 'bg-indigo-600',
    capabilities: ['message.send', 'notification.push'],
    requiredFields: [
      { key: 'webhookUrl', label: 'Incoming Webhook URL', type: 'url', placeholder: 'https://outlook.office.com/webhook/...', required: true },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product', 'marketing'],
  },

  // Data & Infra
  {
    id: 'perplexity',
    name: 'Perplexity AI',
    description: 'Real-time web search and research synthesis.',
    category: 'data',
    authType: 'api-key',
    icon: 'Px',
    color: 'bg-teal-600',
    capabilities: ['search.web', 'research.synthesize'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'pplx-...', required: true, hint: 'Get from perplexity.ai/settings/api' },
    ],
    sandboxAvailable: true,
    personas: ['engineering', 'product', 'marketing'],
  },
  {
    id: 'snowflake',
    name: 'Snowflake',
    description: 'Run SQL queries, export data for analysis and reporting.',
    category: 'data',
    authType: 'credentials',
    icon: '❄',
    color: 'bg-sky-500',
    capabilities: ['data.query', 'data.export'],
    requiredFields: [
      { key: 'account', label: 'Account Identifier', type: 'text', placeholder: 'orgname-accountname', required: true },
      { key: 'username', label: 'Username', type: 'text', placeholder: 'your-username', required: true },
      { key: 'password', label: 'Password', type: 'password', placeholder: 'your-password', required: true },
      { key: 'warehouse', label: 'Warehouse', type: 'text', placeholder: 'COMPUTE_WH', required: false },
    ],
    sandboxAvailable: false,
    personas: ['marketing'],
  },
  {
    id: 'google-analytics',
    name: 'Google Analytics 4',
    description: 'Pull GA4 metrics, conversion funnels, and audience data.',
    category: 'data',
    authType: 'oauth',
    icon: 'GA',
    color: 'bg-orange-500',
    capabilities: ['analytics.read', 'report.run'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'OAuth token', required: true },
      { key: 'propertyId', label: 'GA4 Property ID', type: 'text', placeholder: '123456789', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },
  // Marketing-specific connectors
  {
    id: 'google-ads',
    name: 'Google Ads',
    description: 'Search, display, and video ad campaigns via Google Ads API.',
    category: 'crm-ads',
    authType: 'oauth',
    icon: 'G',
    color: 'bg-blue-500',
    capabilities: ['ads.create', 'ads.manage', 'ads.report'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'OAuth token', required: true },
      { key: 'customerId', label: 'Customer ID', type: 'text', placeholder: '123-456-7890', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },
  {
    id: 'meta-ads',
    name: 'Meta Ads',
    description: 'Facebook & Instagram ad campaigns, audiences, and reporting.',
    category: 'crm-ads',
    authType: 'oauth',
    icon: 'M',
    color: 'bg-blue-600',
    capabilities: ['ads.create', 'ads.manage', 'ads.report'],
    requiredFields: [
      { key: 'accessToken', label: 'Access Token', type: 'password', placeholder: 'OAuth token', required: true },
      { key: 'adAccountId', label: 'Ad Account ID', type: 'text', placeholder: 'act_123456', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing'],
  },
  {
    id: 'wordpress',
    name: 'WordPress',
    description: 'Publish and manage posts, pages, and media on WordPress sites.',
    category: 'cms',
    authType: 'api-key',
    icon: 'W',
    color: 'bg-blue-700',
    capabilities: ['content.publish', 'content.manage', 'media.upload'],
    requiredFields: [
      { key: 'siteUrl', label: 'Site URL', type: 'text', placeholder: 'https://yoursite.com', required: true },
      { key: 'apiKey', label: 'Application Password', type: 'password', placeholder: 'xxxx xxxx xxxx', required: true },
    ],
    sandboxAvailable: false,
    personas: ['marketing'],
  },
  {
    id: 'ahrefs',
    name: 'Ahrefs',
    description: 'Backlink analysis, keyword research, and SEO auditing.',
    category: 'data',
    authType: 'api-key',
    icon: 'Ah',
    color: 'bg-orange-600',
    capabilities: ['seo.backlinks', 'seo.keywords', 'seo.audit'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Ahrefs API key', required: true },
    ],
    sandboxAvailable: false,
    personas: ['marketing'],
  },
  {
    id: 'semrush',
    name: 'Semrush',
    description: 'Competitive analysis, keyword tracking, and content optimization.',
    category: 'data',
    authType: 'api-key',
    icon: 'S',
    color: 'bg-orange-500',
    capabilities: ['seo.keywords', 'seo.competitive', 'content.optimize'],
    requiredFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'Your Semrush API key', required: true },
    ],
    sandboxAvailable: false,
    personas: ['marketing'],
  },
  {
    id: 'dall-e',
    name: 'DALL-E',
    description: 'AI image generation for marketing creatives and illustrations.',
    category: 'ai-models',
    authType: 'api-key',
    icon: 'D',
    color: 'bg-green-500',
    capabilities: ['image.generate', 'image.edit'],
    requiredFields: [
      { key: 'apiKey', label: 'OpenAI API Key', type: 'password', placeholder: 'sk-...', required: true },
    ],
    sandboxAvailable: true,
    personas: ['marketing', 'product'],
  },
];

export const CATEGORY_META: Record<ConnectorCategory, { label: string; icon: string; description: string }> = {
  'ai-models':  { label: 'AI Models',                icon: '🤖', description: 'LLMs and AI inference endpoints' },
  'storage':    { label: 'Storage & Docs',            icon: '📁', description: 'Documents, wikis, and file stores' },
  'design':     { label: 'Design',                    icon: '🎨', description: 'Design and creative tools' },
  'crm-ads':    { label: 'CRM & Ads',                 icon: '📣', description: 'CRM, email, and ad platforms' },
  'dev-tools':  { label: 'Dev Tools',                 icon: '⚙️', description: 'Version control, issue tracking, observability' },
  'cms':        { label: 'CMS & Publishing',          icon: '📝', description: 'Content management and publishing' },
  'messaging':  { label: 'Messaging & Notifications', icon: '💬', description: 'Slack, Teams, and notification channels' },
  'data':       { label: 'Data & Infra',              icon: '📊', description: 'Analytics, databases, and data pipelines' },
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ConnectionsState {
  connections: Record<string, ConnectorState>;
  activeCategory: ConnectorCategory | 'all';
  setActiveCategory: (cat: ConnectorCategory | 'all') => void;
  setConnectionStatus: (connectorId: string, state: Partial<ConnectorState>) => void;
  getStatus: (connectorId: string) => ConnectionStatus;
  getConnectedCount: () => number;
  getConnectedIds: () => string[];
  /** Check if a tool is connected by connector ID OR display name (e.g. 'anthropic' or 'Claude') */
  isToolConnected: (toolNameOrId: string) => boolean;
}

// Build a lookup from display-name → connector-id (e.g. 'Claude' → 'anthropic', 'GitHub' → 'github')
const NAME_TO_ID: Record<string, string> = {};
CONNECTOR_CATALOG.forEach(c => {
  NAME_TO_ID[c.id.toLowerCase()] = c.id;
  NAME_TO_ID[c.name.toLowerCase()] = c.id;
  // Also map common short names
  const short = c.name.replace(/\s+(AI|Ads)?$/i, '').toLowerCase();
  if (short !== c.name.toLowerCase()) NAME_TO_ID[short] = c.id;
});
// Manual aliases for common tool references in skill definitions
NAME_TO_ID['claude'] = 'anthropic';
NAME_TO_ID['anthropic claude'] = 'anthropic';
NAME_TO_ID['linkedin ads'] = 'linkedin-ads';
NAME_TO_ID['linkedin'] = 'linkedin-ads';
NAME_TO_ID['google drive'] = 'google-drive';
NAME_TO_ID['gdrive'] = 'google-drive';
NAME_TO_ID['google analytics'] = 'google-analytics';
NAME_TO_ID['google analytics 4'] = 'google-analytics';
NAME_TO_ID['ms teams'] = 'ms-teams';
NAME_TO_ID['microsoft teams'] = 'ms-teams';
NAME_TO_ID['teams'] = 'ms-teams';
NAME_TO_ID['perplexity'] = 'perplexity';
NAME_TO_ID['perplexity ai'] = 'perplexity';
NAME_TO_ID['ga4'] = 'google-analytics';
NAME_TO_ID['google ads'] = 'google-ads';
NAME_TO_ID['meta ads'] = 'meta-ads';
NAME_TO_ID['facebook ads'] = 'meta-ads';
NAME_TO_ID['dall-e'] = 'dall-e';
NAME_TO_ID['dalle'] = 'dall-e';
NAME_TO_ID['ahrefs'] = 'ahrefs';
NAME_TO_ID['semrush'] = 'semrush';
NAME_TO_ID['wordpress'] = 'wordpress';

/** Resolve a tool name or ID to the canonical connector ID */
export function resolveConnectorId(toolNameOrId: string): string | undefined {
  return NAME_TO_ID[toolNameOrId.toLowerCase()];
}

const DEFAULT_CONNECTED = new Set<string>([]); // Nothing pre-connected — user must connect tools

export const useConnectionsStore = create<ConnectionsState>()(persist((set, get) => ({
  connections: Object.fromEntries(
    CONNECTOR_CATALOG.map(c => [
      c.id,
      {
        connectorId: c.id,
        status: DEFAULT_CONNECTED.has(c.id) ? 'connected' : 'not-connected',
        connectedAt: DEFAULT_CONNECTED.has(c.id) ? new Date().toISOString() : undefined,
      } as ConnectorState,
    ])
  ),

  activeCategory: 'all',
  setActiveCategory: (cat) => set({ activeCategory: cat }),

  setConnectionStatus: (connectorId, partial) =>
    set(s => ({
      connections: {
        ...s.connections,
        [connectorId]: { ...s.connections[connectorId], ...partial },
      },
    })),

  getStatus: (connectorId) => {
    const c = get().connections[connectorId];
    return c?.status ?? 'not-connected';
  },

  getConnectedCount: () => {
    return Object.values(get().connections).filter(c => c.status === 'connected' || c.status === 'sandbox').length;
  },

  getConnectedIds: () => {
    return Object.entries(get().connections)
      .filter(([, c]) => c.status === 'connected' || c.status === 'sandbox')
      .map(([id]) => id);
  },

  isToolConnected: (toolNameOrId: string) => {
    // Try direct ID match first
    const direct = get().connections[toolNameOrId];
    if (direct) return direct.status === 'connected' || direct.status === 'sandbox';
    // Try name → ID resolution
    const resolved = resolveConnectorId(toolNameOrId);
    if (!resolved) return false;
    const conn = get().connections[resolved];
    return conn ? (conn.status === 'connected' || conn.status === 'sandbox') : false;
  },
}), {
  name: 'connections-store',
  partialize: (state) => ({
    connections: state.connections,
  }),
}));
