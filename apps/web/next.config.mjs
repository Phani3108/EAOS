/**
 * Next.js config for AgentOS web app.
 * Marketing UI can be deployed under marketing.* subdomain — set
 * NEXT_PUBLIC_GATEWAY_URL to main AgentOS backend (e.g. https://api.agentos.com).
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
    // Emit a self-contained server (.next/standalone/server.js) so Vercel "services"
    // (which run each service as a server) have a runnable entrypoint for the web service.
    output: 'standalone',
    transpilePackages: ['@agentos/sdk', '@agentos/output-schemas', '@agentos/streaming', '@agentos/gateway'],
    // Marketing subdomain: build with basePath when deploying to marketing.agentos.com
    // basePath: process.env.MARKETING_SUBDOMAIN === 'true' ? '/marketing' : undefined,

    // SPA-style routing: all paths served by the root page.tsx
    async rewrites() {
        return [
            { source: '/:path*', destination: '/' },
        ];
    },
};

export default nextConfig;
