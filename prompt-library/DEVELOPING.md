# Developer Guide

This guide explains how to build, test, and deploy the AgentOS Prompt Library locally.

## Prerequisites

Before you start, ensure you have:

- **Docker** and **Docker Compose** installed (or Docker Desktop)
- **Colima** (optional, recommended on macOS)
- **Make** (comes with macOS/Linux)

## Quick Start

### First-Time Setup

```bash
# 1. Start Docker runtime
make init

# 2. Set up environment (checks prerequisites, creates .env, pulls base image)
make setup

# 3. Deploy locally with Docker Compose
make compose-install

# 4. Verify it's running
make compose-test

# Access the application at http://localhost:4444
```

**Note:** First run takes 2-3 minutes as it builds from the upstream prompts.chat image (clones repo, installs packages, runs Next.js build, applies database migrations, seeds data).

---

## Available Commands

### Infrastructure Management

| Command | Purpose |
|---------|---------|
| `make init` | Start Docker runtime (Colima on macOS) |
| `make setup` | Check prerequisites, create .env file, pull base image |

### Building & Linting

| Command | Purpose |
|---------|---------|
| `make build` | Build Docker image with version and commit metadata |
| `make build-no-cache` | Build Docker image without using cache (slower but clean) |
| `make lint` | Validate Docker Compose YAML, Dockerfile, and Makefile syntax |

### Testing & Validation

| Command | Purpose |
|---------|---------|
| `make test` | Run health check for the running deployment |
| `make compose-test` | Run health check for Docker Compose deployment (90s timeout) |

---

## Docker Compose Workflow

Docker Compose is the supported local deployment method.

### Lifecycle Commands

These follow a Maven-style lifecycle pattern where each phase builds on the previous:

```bash
make compose-validate    # Phase 1: Validate compose.yml syntax
make compose-compile     # Phase 2: validate → build Docker image
make compose-install     # Phase 3: compile → start containers
make compose-verify      # Phase 4: install → verify deployment health
```

**Shortcut:** `make compose-install` runs all phases automatically.

### Operational Commands

| Command | Purpose |
|---------|---------|
| `make c` | Alias for compose-deploy (quick deploy) |
| `make c-logs` | Stream container logs (follow mode) |
| `make compose-logs` | View container logs |
| `make compose-restart` | Restart all containers |
| `make compose-shell` | Open shell in app container |
| `make compose-status` | Show container status |
| `make compose-clean` | Stop and remove containers, networks, volumes |

### Example Workflow

```bash
# Deploy
make c

# Check logs
make c-logs

# Make a change to code, rebuild and restart
make build && make compose-restart

# Clean up when done
make compose-clean
```

---

## Environment Configuration

All configuration is in `.env` file (created by `make setup`). Key variables:

```bash
# Database
DATABASE_URL=postgresql://...
POSTGRES_USER=agentos_prompt_user
POSTGRES_PASSWORD=...
POSTGRES_DB=agentos_prompts

# Authentication (GitHub SSO)
AUTH_SECRET=...
AUTH_GITHUB_ID=...
AUTH_GITHUB_SECRET=...

# Branding
PCHAT_BRANDING_NAME="AgentOS Prompt Library"
PCHAT_BRANDING_LOGO_URL="/logo.svg"
PCHAT_AUTH_GITHUB_ENABLED=true
PCHAT_FEATURES_PRIVATE_PROMPTS_ENABLED=true
```

**Important:** Never commit `.env` to git. It's in `.gitignore`.

---

## Common Workflows

### Local Development Loop

```bash
# 1. Start fresh
make compose-clean
make compose-install

# 2. Make code changes

# 3. Rebuild and restart
make build && make compose-restart

# 4. Check logs
make c-logs

# 5. Validate configuration
make lint
```

### Testing Before CI/CD

```bash
# Lint all config files
make lint

# Build without cache (clean build)
make build-no-cache

# Full lifecycle test
make compose-clean
make compose-install
make compose-test
```

### Debugging

```bash
# Check what's running
make compose-status

# View logs
make c-logs

# Open shell in container
make compose-shell

# Inside shell, you can:
# - Check files: ls -la /app
# - Inspect env: env | grep PCHAT
# - Check process: ps aux
```

---

## Help & Documentation

```bash
# Show all available commands with descriptions
make help

# See this guide
cat DEVELOPING.md

# See project overview
cat README.md
```

---

## Important Notes for Developers

### Base Image

- Uses `ghcr.io/f/prompts.chat:latest` as foundation
- Extends with branding via environment variables
- First run clones upstream repo and builds from source (~2-3 min)

### Ports

- Application runs on `localhost:4444` (external) → `3000` (internal)

### Database

- PostgreSQL 15 with Prisma ORM
- Migrations applied automatically on startup
- Seeds sample data via `prisma/seed.ts`

### Registry

- Local images are built and tagged as `agentos-prompt-library:latest`
- Set your own registry via the `IMAGE_NAME` make variable if you push to a private registry

### Testing Timeouts

- Health checks use 90-second timeout (accounts for first-run build time)
- If tests fail with timeout, it's likely the app is still building
- Check logs with `make c-logs`

---

## Important Notes for AI Agents

When working on this project:

1. **Makefile is the single source of truth** — All workflows are orchestrated through make targets
2. **Always run linter before committing** — `make lint` validates all config files
3. **Use lifecycle phases** — `make compose-install` (not individual steps)
4. **First run is slow** — Building from upstream takes 2-3 minutes, this is normal
5. **Short aliases exist** — Use `make c` for quick deploys

---

## Troubleshooting

### "No deployment detected" when running `make test`

- Run `make compose-install` first
- Verify containers are running: `make compose-status`

### Health check fails with timeout

- Check logs: `make c-logs`
- Likely app is still building on first run (wait 2-3 min)
- Verify database is healthy: `docker compose ps` (should show "healthy" status)

### Cannot access application

- Check <http://localhost:4444> (not 3000)

### Image build fails

- Try clean build: `make build-no-cache`
- Ensure Docker has enough resources (4GB+ RAM recommended)
- Check Docker daemon: `docker ps` should work

### Database connection errors

- Verify .env file exists: `ls -la .env`
- Check `DATABASE_URL` is set correctly
- Ensure db container is healthy: `docker compose ps`
