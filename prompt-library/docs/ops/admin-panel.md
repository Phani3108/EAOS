# Admin Panel Guide

> How to access and operate the AgentOS Prompt Library admin panel.

---

## Accessing the Admin Panel

### URL

```
http://<app-url>/admin
```

- **Local (Helm):** http://localhost:4444/admin (while `make helm-port-forward` is running)
- **Local (Compose):** http://localhost:4444/admin

### Login

The app uses **GitHub SSO** — there is no username/password login form.

1. Go to the app URL
2. Click **Sign in with GitHub**
3. Authorise the GitHub OAuth App
4. You land on the app as a regular user

**To reach `/admin`**, your GitHub account must have the `ADMIN` role in the database.

---

## How Admin Roles Work

The app is **GitHub SSO only** — there is no email/password login. Admin roles are managed declaratively via `config/admins.json` in the repository.

### The seed user (`admin@agentos.dev`)

The seed script creates a DB record for `admin@agentos.dev` with `ADMIN` role. This record exists solely as the **author** of seeded prompt content. It is **not a login credential** — unless someone's GitHub account verified email is literally `admin@agentos.dev`, this account cannot be used to sign in.

### Declarative admin sync

`config/admins.json` is the source of truth for who should be `ADMIN`:

```json
{
  "_comment": "Declarative list of admins. Run 'make helm-sync-admins' after changes.",
  "admins": [
    "admin@agentos.dev"
  ]
}
```

`scripts/sync-admins.js` is **baked into the image** and runs automatically on every pod startup (after migrations). It promotes listed emails to `ADMIN` — idempotent, never demotes.

---

## Admin Panel Sections

Navigate via tabs on the `/admin` page:

| Tab | What you can do |
|-----|-----------------|
| **Users** | View all users, change role (`USER` / `ADMIN`), ban/unban |
| **Prompts** | View, edit, feature, publish, or delete any prompt |
| **Categories** | Create / edit / delete prompt categories and icons |
| **Tags** | Create / edit / delete tags |
| **Reports** | Review user-reported prompts, take action |
| **Webhooks** | Register and test outbound webhooks |

---

## Adding a New Admin

### Step 1 — Declare them in git

Edit `config/admins.json`, add their `@agentos.dev` email, commit and push:

```json
{
  "admins": [
    "admin@agentos.dev",
    "newadmin@agentos.dev"
  ]
}
```

### Step 2 — They must log in once

The user **must sign in via GitHub SSO at least once** before they can be promoted. GitHub SSO creates the DB record on first login. Sync cannot promote a user who has never logged in.

### Step 3 — Run sync

```bash
# After a new image build+deploy (sync runs automatically at pod startup)
# OR immediately without rebuilding:
make helm-sync-admins
```

`make helm-sync-admins` execs `node scripts/sync-admins.js` directly in the running pod — no image rebuild required for day-0 bootstrapping.

**For production clusters** (where you have `kubectl` access pointed at the prod context):

```bash
kubectl exec -n agentos-prompt-library \
  $(kubectl get pod -n agentos-prompt-library -l app.kubernetes.io/name=agentos-prompt-library -o jsonpath='{.items[0].metadata.name}') \
  -- node scripts/sync-admins.js
```

> Since `sync-admins.js` and `config/admins.json` are baked into the image, no file copying is needed in prod — exec directly.

---

## Bootstrap Flow (First Deploy)

```
1. Deploy → pod starts → sync runs → skips all (no GitHub users in DB yet)
2. Target admin logs in via GitHub SSO → DB record created
3. Run: make helm-sync-admins  (or kubectl exec ... node scripts/sync-admins.js)
4. Done — that user is now ADMIN, and stays ADMIN on all future restarts
```

After bootstrap, subsequent pod restarts automatically re-confirm admin roles at startup.

---

## Promote via Admin UI (if already admin)

1. Go to `/admin` → **Users** tab
2. Find the user, click edit, set role to `ADMIN`

---

## Managing Content

### Categories

Create Organization categories (Engineering, SRE, Product, etc.) via **Categories** tab.

Required fields: `name`, `slug`  
Optional: `icon` (emoji), `pinned` (shows at top)

### Prompts

- All user-submitted prompts appear here
- Admin can **feature** a prompt (shows in homepage highlights)
- Admin can **publish** a draft or **delete** any prompt

### Bulk Import via CSV

Upload a CSV at `POST /api/admin/import-prompts`.  
CSV columns: `act`, `prompt`, `for_devs`, `type`, `contributor`

```bash
curl -X POST http://localhost:4444/api/admin/import-prompts \
  -H "Cookie: authjs.session-token=<token>" \
  -F "file=@prompts.csv"
```

---

## Production Notes

- **Seeding is skipped in production** — `SEED_DATABASE` is not set in `values.yaml` (only in `values-local.yaml`)
- **Admin sync always runs** — `scripts/sync-admins.js` runs on every pod startup in all environments
- `admin@agentos.dev` (seed user) owns seeded prompt content but cannot log in unless a real GitHub account uses that email
- Manage admins via `config/admins.json` in git — commit the change, deploy, then run `make helm-sync-admins` for immediate effect without waiting for the next pod restart
