# Multi-stage Dockerfile for EAOS services
# Build: docker build --build-arg SERVICE=gateway -t eaos-gateway .

# --- Stage 1: Base ---
FROM node:22.23.2-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

# --- Stage 2: Dependencies ---
FROM base AS deps
COPY . .
RUN pnpm install --frozen-lockfile --prod=false

# --- Stage 3: Build ---
FROM deps AS build
ARG SERVICE=gateway
ARG GATEWAY_INTERNAL_URL=http://gateway:3000
ENV GATEWAY_INTERNAL_URL=${GATEWAY_INTERNAL_URL}
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
RUN cp -R apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

# --- Stage 4: Production Runtime ---
FROM node:22.23.2-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

ARG SERVICE=gateway
ENV NODE_ENV=production
ENV SERVICE_NAME=${SERVICE}

# Copy built output
COPY --from=build /app /app

# Non-root user
RUN addgroup -g 1001 eaos && adduser -u 1001 -G eaos -s /bin/sh -D eaos && mkdir -p /app/.agentos-data && chown eaos:eaos /app/.agentos-data
USER eaos

EXPOSE 3000 3001 3002 3004 3005 3006 3007

# Use shell form so SERVICE env var is expanded at runtime.
# Gateway compiles to dist/server.js; other services fall back to dist/index.js.
CMD ["sh", "-c", "if [ \"${SERVICE_NAME}\" = \"web\" ]; then HOSTNAME=0.0.0.0 PORT=3010 exec node apps/web/.next/standalone/apps/web/server.js; elif [ -f services/${SERVICE_NAME}/dist/server.js ]; then exec node services/${SERVICE_NAME}/dist/server.js; else exec node services/${SERVICE_NAME}/dist/index.js; fi"]
