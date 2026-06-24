/**
 * Real MCP (Model Context Protocol) client layer.
 *
 * Connects to MCP servers (stdio or HTTP) using the official @modelcontextprotocol/sdk,
 * lists their tools, and calls them — giving EAOS a genuine MCP client. (The legacy
 * `mcp-executor.ts` is NOT real MCP; it's a bespoke dispatcher with simulated fallbacks.)
 *
 * The SDK is imported DYNAMICALLY so the gateway still boots when the dependency isn't
 * installed yet or no servers are configured — matching EAOS's simulation-fallback
 * philosophy. Nothing here throws into the boot path.
 */

export interface McpServerConfig {
  id: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpToolDescriptor {
  server: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  ok: boolean;
  server: string;
  tool: string;
  content: string; // concatenated text content blocks
  structured?: Record<string, unknown>;
  isError?: boolean;
  error?: string;
}

interface ConnectedServer {
  id: string;
  transport: 'stdio' | 'http';
  client: any;
  tools: McpToolDescriptor[];
  status: 'connected' | 'error';
  error?: string;
}

// Cached dynamic SDK handles (loaded once, on first connect).
let sdk: { Client: any; StdioClientTransport: any; HttpTransport: any } | null = null;
let sdkLoadFailed = false;

async function loadSdk(): Promise<typeof sdk> {
  if (sdk || sdkLoadFailed) return sdk;
  try {
    const clientMod = await import('@modelcontextprotocol/sdk/client/index.js');
    const stdioMod = await import('@modelcontextprotocol/sdk/client/stdio.js');
    let HttpTransport: any = null;
    try {
      const m = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
      HttpTransport = m.StreamableHTTPClientTransport;
    } catch {
      const m = await import('@modelcontextprotocol/sdk/client/sse.js');
      HttpTransport = m.SSEClientTransport;
    }
    sdk = { Client: clientMod.Client, StdioClientTransport: stdioMod.StdioClientTransport, HttpTransport };
    return sdk;
  } catch (err) {
    sdkLoadFailed = true;
    console.warn('[mcp] @modelcontextprotocol/sdk not available — MCP servers disabled. Run `pnpm install` to enable.', (err as Error).message);
    return null;
  }
}

function cleanEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (typeof v === 'string') base[k] = v;
  return { ...base, ...(extra ?? {}) };
}

export class McpClientManager {
  private servers = new Map<string, ConnectedServer>();

  /** True when a connected MCP server with this id exists. */
  hasServer(id: string): boolean {
    const s = this.servers.get(id);
    return !!s && s.status === 'connected';
  }

  /** Connect all configured servers (best-effort). Returns the count connected. */
  async init(configs: McpServerConfig[]): Promise<number> {
    if (!configs.length) return 0;
    const loaded = await loadSdk();
    if (!loaded) return 0;
    let connected = 0;
    for (const cfg of configs) {
      try {
        await this.connectServer(cfg);
        connected++;
      } catch (err) {
        this.servers.set(cfg.id, { id: cfg.id, transport: cfg.transport, client: null, tools: [], status: 'error', error: (err as Error).message });
        console.warn(`[mcp] failed to connect "${cfg.id}":`, (err as Error).message);
      }
    }
    return connected;
  }

  private async connectServer(cfg: McpServerConfig): Promise<void> {
    const loaded = await loadSdk();
    if (!loaded) throw new Error('MCP SDK unavailable');

    const client = new loaded.Client({ name: 'eaos-gateway', version: '0.1.0' }, { capabilities: {} });

    let transport: any;
    if (cfg.transport === 'stdio') {
      if (!cfg.command) throw new Error(`stdio server "${cfg.id}" missing command`);
      transport = new loaded.StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cleanEnv(cfg.env) });
    } else {
      if (!cfg.url) throw new Error(`http server "${cfg.id}" missing url`);
      const url = new URL(cfg.url);
      transport = new loaded.HttpTransport(url, cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined);
    }

    await client.connect(transport);
    const listed = await client.listTools();
    const tools: McpToolDescriptor[] = (listed?.tools ?? []).map((t: any) => ({
      server: cfg.id, name: t.name, description: t.description, inputSchema: t.inputSchema,
    }));
    this.servers.set(cfg.id, { id: cfg.id, transport: cfg.transport, client, tools, status: 'connected' });
    console.log(`[mcp] connected "${cfg.id}" (${cfg.transport}) — ${tools.length} tools`);
  }

  getServerStatus(): Array<{ id: string; transport: string; connected: boolean; toolCount: number; tools: string[]; error?: string }> {
    return Array.from(this.servers.values()).map(s => ({
      id: s.id, transport: s.transport, connected: s.status === 'connected',
      toolCount: s.tools.length, tools: s.tools.map(t => t.name), error: s.error,
    }));
  }

  listTools(serverId?: string): McpToolDescriptor[] {
    const all: McpToolDescriptor[] = [];
    for (const s of this.servers.values()) {
      if (serverId && s.id !== serverId) continue;
      all.push(...s.tools);
    }
    return all;
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown> = {}): Promise<McpCallResult> {
    const srv = this.servers.get(serverId);
    if (!srv || srv.status !== 'connected' || !srv.client) {
      return { ok: false, server: serverId, tool: toolName, content: '', error: `MCP server not connected: ${serverId}` };
    }
    try {
      const result = await srv.client.callTool({ name: toolName, arguments: args });
      const content = Array.isArray(result?.content)
        ? result.content.filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('\n')
        : '';
      return {
        ok: !result?.isError,
        server: serverId,
        tool: toolName,
        content,
        structured: result?.structuredContent,
        isError: !!result?.isError,
        error: result?.isError ? (content || 'tool reported an error') : undefined,
      };
    } catch (err) {
      return { ok: false, server: serverId, tool: toolName, content: '', error: (err as Error).message };
    }
  }

  async disconnectAll(): Promise<void> {
    for (const s of this.servers.values()) {
      try { await s.client?.close?.(); } catch { /* ignore */ }
    }
    this.servers.clear();
  }
}
