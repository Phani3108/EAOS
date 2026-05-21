# Content Management Operations Guide

> Reference for managing categories, prompts, tags, and users in AgentOS Prompt Library.

## Overview

Content is managed through two mechanisms:

| Mechanism | When | Who |
|-----------|------|-----|
| Seed script (`seed.ts`) | First deploy only | Platform team (ops) |
| Admin UI (`/admin`) + APIs | Ongoing | admins |
| Self-service UI (`/prompts/new`) | Anytime | All authenticated users |

---

## First Deploy: Database Seeding

### What seeding creates

- Admin user: `admin@agentos.dev`
- Organization categories: Engineering, SRE, QA, Product, Data, etc.
- Initial curated prompt library (organization-specific)

### Local (Compose)

```bash
make compose-seed
```

### Local (Helm / Colima)

Seeding is controlled by `SEED_DATABASE=true` in `helm-chart/values-local.yaml`.  
It runs automatically on pod startup when set.

To re-seed after a reset:

```bash
make helm-uninstall && make helm-deploy
# seeding runs on first startup
```

To seed a running pod without restart:

```bash
kubectl exec -n agentos-prompt-library deployment/agentos-prompt-library -- \
  node_modules/.bin/tsx prisma/seed.ts
```

### Production (Kubernetes)

`SEED_DATABASE` is **not set** in production `values.yaml` — seeding never runs automatically.

Run seed once at initial rollout via a one-shot exec:

```bash
kubectl exec -n agentos-prompt-library deployment/agentos-prompt-library -- \
  node_modules/.bin/tsx prisma/seed.ts
```

The seed script is **idempotent** — safe to run multiple times:
- Users and categories use `upsert`
- Prompts check `findFirst` before creating

---

## Ongoing Content Management

### Admin UI

Available at: `http://<app-url>/admin`

Requires `ADMIN` role. The seed creates `admin@agentos.dev` as the initial admin.

### Promote a user to admin

```bash
# Find the user ID first
kubectl exec -n agentos-prompt-library deployment/agentos-prompt-library -- \
  node -e "
    const { PrismaClient } = require('.prisma/client');
    const db = new PrismaClient();
    db.user.findMany({ select: { id: true, email: true, role: true } })
      .then(u => console.log(JSON.stringify(u, null, 2)))
      .finally(() => db.\$disconnect());
  "

# Promote by email via the admin API (requires existing admin session)
curl -X PATCH http://localhost:4444/api/admin/users/<user-id> \
  -H "Cookie: <session-cookie>" \
  -H "Content-Type: application/json" \
  -d '{"role": "ADMIN"}'
```

Or use `prisma/reset-admin.ts`:

```bash
kubectl exec -n agentos-prompt-library deployment/agentos-prompt-library -- \
  node_modules/.bin/tsx prisma/reset-admin.ts
```

---

## Admin API Reference

All endpoints require an authenticated `ADMIN` session cookie.

### Categories

| Method | Endpoint | Action |
|--------|----------|--------|
| `GET` | `/api/admin/categories` | List all |
| `POST` | `/api/admin/categories` | Create |
| `PATCH` | `/api/admin/categories/:id` | Update |
| `DELETE` | `/api/admin/categories/:id` | Delete |

**Create category:**
```bash
curl -X POST http://localhost:4444/api/admin/categories \
  -H "Cookie: <session>" \
  -H "Content-Type: application/json" \
  -d '{"name": "DevOps", "slug": "devops", "icon": "🚀", "pinned": false}'
```

### Prompts

| Method | Endpoint | Action |
|--------|----------|--------|
| `GET` | `/api/admin/prompts` | List all |
| `POST` | `/api/admin/prompts` | Create |
| `PATCH` | `/api/admin/prompts/:id` | Update / feature / publish |
| `DELETE` | `/api/admin/prompts/:id` | Delete |

### Bulk Import (CSV)

Upload prompts in CSV format (columns: `act`, `prompt`, `for_devs`, `type`, `contributor`):

```bash
curl -X POST http://localhost:4444/api/admin/import-prompts \
  -H "Cookie: <session>" \
  -F "file=@prompts.csv"
```

### Tags

| Method | Endpoint | Action |
|--------|----------|--------|
| `POST` | `/api/admin/tags` | Create |
| `PATCH` | `/api/admin/tags/:id` | Update |
| `DELETE` | `/api/admin/tags/:id` | Delete |

### Users

| Method | Endpoint | Action |
|--------|----------|--------|
| `GET` | `/api/admin/users` | List all |
| `PATCH` | `/api/admin/users/:id` | Update role / ban |
| `DELETE` | `/api/admin/users/:id` | Remove |

---

## Environment Variables: Content Controls

| Variable | Default | Effect |
|----------|---------|--------|
| `SEED_DATABASE` | `false` | Run `seed.ts` on startup |
| `ALLOW_REGISTRATION` | `false` | Allow public sign-up (baked at build time) |
| `FEATURE_PRIVATE_PROMPTS` | `true` | Users can create private prompts |
| `FEATURE_CHANGE_REQUESTS` | `true` | Enable prompt change request workflow |

> `ALLOW_REGISTRATION` and `FEATURE_*` flags are baked into the image at build time via
> `prompts.config.ts`. Changing them requires a rebuild.

---

## Production Checklist (First Rollout)

- [ ] Confirm `SEED_DATABASE` is not set in production values
- [ ] Deploy the release
- [ ] Wait for pod to be `Running` and healthy
- [ ] Run seed once: `kubectl exec ... tsx prisma/seed.ts`
- [ ] Log in as `admin@agentos.dev` at `/admin`
- [ ] Verify categories and prompts are visible
- [ ] Promote additional admins as needed
- [ ] Announce URL to engineering teams
