# Production Dockerfile for AgentOS Prompt Library
# Multi-stage build for Kubernetes-ready deployment
# AI prompt curation platform with GitHub SSO

# =============================================================================
# Stage 1: Build prompts.chat application
# =============================================================================
# Note: Using node:24-alpine to match the engine requirement in package.json (node: '24.x').
# - Node 24 became LTS in October 2025; supported until April 2028
# - Alpine base keeps the image ~60% smaller than Debian-slim = faster pulls, smaller final image
# - Reduced attack surface for production Kubernetes deployment
# - Upstream uses Debian for embedded PostgreSQL; we use external PostgreSQL
FROM node:24-alpine AS builder

ARG REPO_URL=https://github.com/f/prompts.chat
ARG REPO_BRANCH=main

# Install build dependencies and pin npm in one layer to maximise cache reuse
RUN apk add --no-cache git && \
    npm install -g npm@11.11.0

# Clone prompts.chat repository
WORKDIR /build
RUN git clone --depth 1 --branch ${REPO_BRANCH} ${REPO_URL} .

# Clean up unnecessary files and patch package.json:
#   1. Remove deprecated package.json#prisma key (suppresses Prisma deprecation noise)
#   2. Upgrade vulnerable direct deps to safe versions
#   3. Add npm overrides to force safe versions of transitive vulnerable deps
#
# CVEs addressed:
#   next        ≥16.1.5  (DoS / Resource Throttling - CVE in next@16.1.0)
#   @mcp/sdk    ≥1.26.0  (ReDoS + Race Condition in @mcp/sdk@1.25.1; also pulls in safe qs + ajv)
#   rollup      ≥4.59.0  (Directory Traversal via @sentry/nextjs transitive dep)
#   qs          ≥6.14.2  (DoS via @mcp/sdk transitive dep - belt+suspenders with sdk upgrade)
#   minimatch   ≥10.2.3  (ReDoS + Inefficient Complexity via @sentry/nextjs transitive dep)
#   fast-xml-parser ≥5.3.8 (Uncaught Exception + XMLi + Buffer Overflow via transitive dep)
#   ajv         ≥8.18.0  (ReDoS via @mcp/sdk transitive dep - belt+suspenders with sdk upgrade)
#   @auth/core  ≥0.41.1  (Improper Neutralisation via next-auth transitive dep)
RUN rm -rf .github .claude packages .git && \
    node -e " \
      const fs = require('fs'); \
      const p = JSON.parse(fs.readFileSync('package.json')); \
      delete p.prisma; \
      p.dependencies['next'] = '^16.1.5'; \
      p.dependencies['@modelcontextprotocol/sdk'] = '^1.26.0'; \
      p.overrides = Object.assign({}, p.overrides, { \
        'rollup': '^4.59.0', \
        'qs': '^6.14.2', \
        'minimatch': '^10.2.3', \
        'fast-xml-parser': '^5.3.8', \
        'ajv': '^8.18.0', \
        '@auth/core': '^0.41.1' \
      }); \
      fs.writeFileSync('package.json', JSON.stringify(p, null, 2)); \
    "

# Install dependencies (skip postinstall scripts to avoid Prisma generate)
# npm install (not ci) is used because we patch package.json above to override
# vulnerable transitive deps, which invalidates the upstream package-lock.json.
# npm audit fix is intentionally omitted: it would re-resolve deps unpredictably.
RUN npm install --ignore-scripts

# Generate Prisma client separately
# Note: prisma generate only reads schema file, doesn't connect to database
# Uses dummy URL since Prisma CLI requires it for validation (not actual connection)
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npx prisma generate

# Verify Prisma client was generated
RUN test -d node_modules/.prisma/client || (echo "ERROR: Prisma client not generated" && exit 1)

# Generate prompts.config.ts from environment variables
# Note: docker-setup.js expects specific env var names (BRAND_*, AUTH_*, FEATURE_*)
ARG BRAND_NAME="AgentOS Prompt Library"
ARG BRAND_DESCRIPTION="Curated AI prompts for organization"
ARG BRAND_COLOR="#530296"
ARG AUTH_PROVIDERS="github"
ARG ALLOW_REGISTRATION="false"
ARG FEATURE_PRIVATE_PROMPTS="true"
ARG FEATURE_CHANGE_REQUESTS="true"
ARG FEATURE_CATEGORIES="true"
ARG FEATURE_TAGS="true"
ARG FEATURE_COMMENTS="true"
ARG FEATURE_AI_SEARCH="false"
ARG FEATURE_AI_GENERATION="false"
ARG FEATURE_MCP="false"
ARG THEME_RADIUS="sm"
ARG THEME_VARIANT="default"
ARG LOCALES="en"
ARG DEFAULT_LOCALE="en"

RUN BRAND_NAME="${BRAND_NAME}" \
    BRAND_DESCRIPTION="${BRAND_DESCRIPTION}" \
    BRAND_COLOR="${BRAND_COLOR}" \
    AUTH_PROVIDERS="${AUTH_PROVIDERS}" \
    ALLOW_REGISTRATION="${ALLOW_REGISTRATION}" \
    FEATURE_PRIVATE_PROMPTS="${FEATURE_PRIVATE_PROMPTS}" \
    FEATURE_CHANGE_REQUESTS="${FEATURE_CHANGE_REQUESTS}" \
    FEATURE_CATEGORIES="${FEATURE_CATEGORIES}" \
    FEATURE_TAGS="${FEATURE_TAGS}" \
    FEATURE_COMMENTS="${FEATURE_COMMENTS}" \
    FEATURE_AI_SEARCH="${FEATURE_AI_SEARCH}" \
    FEATURE_AI_GENERATION="${FEATURE_AI_GENERATION}" \
    FEATURE_MCP="${FEATURE_MCP}" \
    THEME_RADIUS="${THEME_RADIUS}" \
    THEME_VARIANT="${THEME_VARIANT}" \
    LOCALES="${LOCALES}" \
    DEFAULT_LOCALE="${DEFAULT_LOCALE}" \
    node scripts/docker-setup.js

# Verify prompts.config.ts was generated
RUN test -f prompts.config.ts || (echo "ERROR: prompts.config.ts not generated" && exit 1)

# Build Next.js application
# Note: build script runs "prisma generate && next build", so DATABASE_URL is needed
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    npm run build

# Verify standalone build was created
RUN test -d .next/standalone || (echo "ERROR: Standalone build not found" && exit 1)

# Copy static assets to standalone directory
RUN cp -r .next/static .next/standalone/.next/ && \
    cp -r public .next/standalone/

# Resolve symlinks in standalone output to avoid Kaniko multi-stage build failures.
# Next.js standalone creates symlinks (e.g. node_modules/@modelcontextprotocol/sdk ->
# ../../../node_modules/@modelcontextprotocol/sdk) that Kaniko cannot copy across
# stage boundaries because it encounters "file exists" collisions when dereferencing.
RUN find .next/standalone -type l | while read link; do \
    target=$(readlink -f "$link"); \
    if [ -e "$target" ]; then \
        rm "$link"; \
        cp -rp "$target" "$link"; \
    fi; \
done

# =============================================================================
# Stage 2: Production runtime image
# =============================================================================
FROM node:24-alpine AS runtime

ARG app=agentos-prompt-library
ARG version=0.1.0
ARG lastCommitHash
ARG lastCommitAuthorEmail

# Install runtime dependencies
# Upgrade npm to match builder stage version (npm@11.11.0 bundles tar@^7.5.9,
# fixing the Directory Traversal CVE present in npm@11.9.0 that ships with node:24-alpine).
RUN apk add --no-cache \
    curl \
    postgresql-client \
    && npm install -g npm@11.11.0 \
    && npm cache clean --force \
    && rm -rf /var/cache/apk/*

# Node Alpine image already has 'node' user (uid 1000)
# No need to create new user

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=node:node /build/.next/standalone ./
COPY --from=builder --chown=node:node /build/.next/standalone/.next ./.next

# Copy Prisma schema and migrations for runtime
COPY --from=builder --chown=node:node /build/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=node:node /build/prisma/migrations ./prisma/migrations

# Install Prisma CLI with all transitive deps (effect, fast-check, etc.) via npm.
# Copying individual packages from builder is fragile — newer @prisma/config versions
# pull in effect → fast-check and other transitive deps that must all be present at runtime.
# A targeted 'npm install prisma' is the robust alternative: resolves the full dep tree,
# takes ~15s, and adds <50 MB vs manually hunting down every missing transitive package.
# tsx is needed to run seed.ts (TypeScript seed script) at startup.
# NOTE: --ignore-scripts is intentionally NOT used here. Prisma's postinstall must run
# to download engine binaries (query-engine, migration-engine) during image build.
# Without this, Prisma attempts to write engine files at container runtime and fails
# with "Can't write to /app/node_modules/@prisma/engines" permission errors.
RUN npm install --no-save prisma tsx \
    && chown -R node:node /app/node_modules

# Copy organization-specific seed script (not in upstream prompts.chat repo)
COPY --chown=node:node prisma/seed.ts /app/prisma/seed.ts

# Copy admin role configuration and sync script
COPY --chown=node:node config/admins.json /app/config/admins.json
COPY --chown=node:node scripts/sync-admins.js /app/scripts/sync-admins.js

# Build-time metadata
ENV ARTIFACT_NAME=$app \
    ARTIFACT_VERSION=$version \
    ARTIFACT_COMMIT_ABR=$lastCommitHash \
    ARTIFACT_COMMITTER=$lastCommitAuthorEmail

# Note: Branding and features are baked into prompts.config.ts at build-time
# Runtime configuration is done via DATABASE_URL, AUTH_* env vars only

# Next.js configuration
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Copy startup script
COPY --chown=node:node scripts/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000

# Switch to non-root user
USER node

# Use custom startup script that runs migrations then starts app
CMD ["/app/start.sh"]
