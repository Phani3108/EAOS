/**
 * Next.js config for AgentOS web app.
 * Marketing UI can be deployed under marketing.* subdomain — set
 * NEXT_PUBLIC_GATEWAY_URL to main AgentOS backend (e.g. https://api.agentos.com).
 */
import { fileURLToPath } from 'node:url';

/**
 * How long the /_/gateway rewrite waits on a silent gateway socket. Next's
 * default is 30 s, which is shorter than one live provider call is allowed to
 * take (PROVIDER_CALL_TIMEOUT_MS) and far shorter than a Regiment Review, which
 * answers only after every reviewer has run. Past it the proxy returns a bare
 * 500 while the gateway carries on billing the calls. Sized above the gateway's
 * own synchronous bounds (REVIEW_DEADLINE_MS; a chat reply's full provider
 * fallback chain) so the gateway always answers first with a real outcome;
 * services/gateway/src/web-proxy-timeout.test.ts keeps the two in step. Kept
 * finite so a hung gateway cannot pin proxy sockets indefinitely.
 */
export const GATEWAY_PROXY_TIMEOUT_MS = 10 * 60_000;

/** @type {import('next').NextConfig} */
const nextConfig = {
    // Emit a self-contained server (.next/standalone/server.js) so Vercel "services"
    // (which run each service as a server) have a runnable entrypoint for the web service.
    output: 'standalone',
    // Trace from the monorepo root explicitly. Left to inference, Next picks the
    // directory of the nearest lockfile it finds, so a checkout nested inside
    // another pnpm project (a git worktree under .claude/worktrees, for one) moves
    // the server to .next/standalone/<nested path>/apps/web/server.js. The browser
    // acceptance test and deploy/Dockerfile start .next/standalone/apps/web/server.js,
    // so they then fail with nothing but "fixture server exited".
    outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
    env: { NEXT_PUBLIC_GATEWAY_URL: '/_/gateway' },
    experimental: { proxyTimeout: GATEWAY_PROXY_TIMEOUT_MS },
    transpilePackages: ['@agentos/sdk', '@agentos/output-schemas', '@agentos/streaming', '@agentos/gateway'],
    // Marketing subdomain: build with basePath when deploying to marketing.agentos.com
    // basePath: process.env.MARKETING_SUBDOMAIN === 'true' ? '/marketing' : undefined,

    // SPA-style routing: all paths served by the root page.tsx
    async rewrites() {
        return [
            { source: '/_/gateway/:path*', destination: `${process.env.GATEWAY_INTERNAL_URL || 'http://127.0.0.1:3000'}/:path*` },
            { source: '/:path*', destination: '/' },
        ];
    },
};

export default nextConfig;
