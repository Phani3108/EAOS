# Environment Variables Reference

## Build-Time Variables (Dockerfile ARG)

These variables are used **during Docker image build** to generate `prompts.config.ts`.

### Branding

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `BRAND_NAME` | Application name | `"My Prompt Library"` | `"AgentOS Prompt Library"` |
| `BRAND_DESCRIPTION` | Application description | `"Collect, organize, and share AI prompts"` | `"Curated AI prompts for organization"` |
| `BRAND_LOGO` | Logo path (light mode) | `"/logo.svg"` | `"/logo.svg"` |
| `BRAND_LOGO_DARK` | Logo path (dark mode) | Same as `BRAND_LOGO` | `"/logo-dark.svg"` |
| `BRAND_FAVICON` | Favicon path | `"/logo.svg"` | `"/favicon.ico"` |
| `BRAND_COLOR` | Primary color (hex) | `"#6366f1"` | `"#6366f1"` |

### Theme

| Variable | Description | Default | Options |
|----------|-------------|---------|---------|
| `THEME_RADIUS` | Border radius | `"sm"` | `"none"`, `"sm"`, `"md"`, `"lg"` |
| `THEME_VARIANT` | UI variant | `"default"` | `"default"`, `"flat"`, `"brutal"` |
| `THEME_DENSITY` | Spacing density | `"default"` | `"compact"`, `"default"`, `"comfortable"` |

### Authentication

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `AUTH_PROVIDERS` | Comma-separated auth providers | `"credentials"` | `"github"` or `"github,google"` |
| `ALLOW_REGISTRATION` | Allow public registration | `"true"` | `"false"` (AgentOS uses SSO only) |

### Features

| Variable | Description | Default |
|----------|-------------|---------|
| `FEATURE_PRIVATE_PROMPTS` | Enable private prompts | `"true"` |
| `FEATURE_CHANGE_REQUESTS` | Enable change request workflow | `"true"` |
| `FEATURE_CATEGORIES` | Enable categories | `"true"` |
| `FEATURE_TAGS` | Enable tags | `"true"` |
| `FEATURE_COMMENTS` | Enable comments | `"true"` |
| `FEATURE_AI_SEARCH` | Enable AI-powered semantic search | `"false"` |
| `FEATURE_AI_GENERATION` | Enable AI prompt generation | `"false"` |
| `FEATURE_MCP` | Enable Model Context Protocol | `"false"` |

### Internationalization

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `LOCALES` | Comma-separated locale codes | `"en"` | `"en,es,ja,zh"` |
| `DEFAULT_LOCALE` | Default locale | `"en"` | `"en"` |

### Usage in Dockerfile

```dockerfile
ARG BRAND_NAME="AgentOS Prompt Library"
ARG BRAND_COLOR="#6366f1"
ARG AUTH_PROVIDERS="github"
ARG ALLOW_REGISTRATION="false"
ARG FEATURE_PRIVATE_PROMPTS="true"
ARG FEATURE_AI_SEARCH="false"

RUN BRAND_NAME="${BRAND_NAME}" \
    BRAND_COLOR="${BRAND_COLOR}" \
    AUTH_PROVIDERS="${AUTH_PROVIDERS}" \
    ALLOW_REGISTRATION="${ALLOW_REGISTRATION}" \
    FEATURE_PRIVATE_PROMPTS="${FEATURE_PRIVATE_PROMPTS}" \
    FEATURE_AI_SEARCH="${FEATURE_AI_SEARCH}" \
    node scripts/docker-setup.js
```

---

## Runtime Variables (Kubernetes ConfigMap/Secret)

These variables are provided **at container runtime** and can be changed without rebuilding the image.

### Required (Always Needed)

| Variable | Source | Description | Example |
|----------|--------|-------------|---------|
| `DATABASE_URL` | Secret (Vault) | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `AUTH_SECRET` | Secret (Vault) | NextAuth.js secret (32+ chars) | `openssl rand -base64 32` |

### Authentication Providers

#### GitHub OAuth

| Variable | Source | Description | Where to Get |
|----------|--------|-------------|--------------|
| `AUTH_GITHUB_ID` | Secret (Vault) | GitHub OAuth Client ID | [GitHub OAuth Apps](https://github.com/settings/developers) |
| `AUTH_GITHUB_SECRET` | Secret (Vault) | GitHub OAuth Client Secret | [GitHub OAuth Apps](https://github.com/settings/developers) |

**Setup:**
1. Go to https://github.com/settings/developers
2. Create New OAuth App
3. Set Homepage URL: `https://prompts.example.com`
4. Set Callback URL: `https://prompts.example.com/api/auth/callback/github`
5. Copy Client ID and Secret

#### Google OAuth (Optional)

| Variable | Source | Description | Where to Get |
|----------|--------|-------------|--------------|
| `AUTH_GOOGLE_ID` | Secret (Vault) | Google OAuth Client ID | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |
| `AUTH_GOOGLE_SECRET` | Secret (Vault) | Google OAuth Client Secret | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |

**Setup:**
1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID
3. Add authorized redirect URI: `https://prompts.example.com/api/auth/callback/google`

### Optional Features

#### AI Search & Generation (OpenAI)

| Variable | Source | Description | Default |
|----------|--------|-------------|---------|
| `OPENAI_API_KEY` | Secret (Vault) | OpenAI API key | None (feature disabled) |
| `OPENAI_BASE_URL` | ConfigMap | Custom API endpoint | `https://api.openai.com/v1` |
| `OPENAI_EMBEDDING_MODEL` | ConfigMap | Model for embeddings | `text-embedding-3-small` |
| `OPENAI_GENERATIVE_MODEL` | ConfigMap | Model for generation | `gpt-4o-mini` |
| `OPENAI_TRANSLATION_MODEL` | ConfigMap | Model for translations | `gpt-4o-mini` |

**Note:** AI features only work if `FEATURE_AI_SEARCH="true"` or `FEATURE_AI_GENERATION="true"` was set at build-time.

#### Storage (S3/DigitalOcean Spaces)

For media uploads (images, videos in prompts):

| Variable | Source | Description |
|----------|--------|-------------|
| `ENABLED_STORAGE` | ConfigMap | Storage provider: `s3`, `do-spaces`, `url` |
| `S3_BUCKET` | Secret | S3 bucket name |
| `S3_REGION` | ConfigMap | AWS region |
| `S3_ACCESS_KEY_ID` | Secret | AWS access key |
| `S3_SECRET_ACCESS_KEY` | Secret | AWS secret key |
| `S3_ENDPOINT` | ConfigMap | Custom endpoint (for MinIO, etc) |

#### Analytics (Optional)

| Variable | Source | Description |
|----------|--------|-------------|
| `GOOGLE_ANALYTICS_ID` | ConfigMap | Google Analytics tracking ID |

#### Misc

| Variable | Source | Description | Default |
|----------|--------|-------------|---------|
| `TZ` | ConfigMap | Timezone | `UTC` |
| `LOG_LEVEL` | ConfigMap | Logging level | `info` |
| `SEED_DATABASE` | ConfigMap | Auto-seed on first run | `false` |
| `CRON_SECRET` | Secret | Secret for cron endpoints | Random string |

### Usage in Kubernetes

#### values.yaml (ConfigMap)
```yaml
envProperties:
  TZ: UTC
  LOG_LEVEL: info
  # Sensitive values from Vault
  DATABASE_URL: vault:secrets/data/cluster/agentos-prompt-library/application#DATABASE_URL
  AUTH_SECRET: vault:secrets/data/cluster/agentos-prompt-library/application#AUTH_SECRET
  AUTH_GITHUB_ID: vault:secrets/data/cluster/agentos-prompt-library/application#AUTH_GITHUB_ID
  AUTH_GITHUB_SECRET: vault:secrets/data/cluster/agentos-prompt-library/application#AUTH_GITHUB_SECRET
```

#### values-local.yaml (Local Testing)
```yaml
envProperties:
  TZ: UTC
  DATABASE_URL: postgresql://agentos_admin:password123@agentos-prompt-library-db:5432/agentos_prompts
  AUTH_SECRET: local-dev-secret-change-in-production-min-32-chars
  AUTH_GITHUB_ID: your-github-oauth-client-id
  AUTH_GITHUB_SECRET: your-github-oauth-client-secret
```

---

## Environment Variable Comparison

### ❌ WRONG: Runtime Override Attempt

```yaml
# This will NOT work - config is baked into image!
envProperties:
  PCHAT_NAME: "Different Name"           # ❌ Ignored
  PCHAT_FEATURE_PRIVATE_PROMPTS: "false" # ❌ Ignored
  DATABASE_URL: postgresql://...         # ✅ Works
```

### ✅ CORRECT: Separate Build-time and Runtime

```dockerfile
# Dockerfile (build-time config)
ARG BRAND_NAME="AgentOS Prompt Library"    # ✅ Baked into prompts.config.ts
ARG FEATURE_PRIVATE_PROMPTS="true"      # ✅ Baked into prompts.config.ts
```

```yaml
# values.yaml (runtime config only)
envProperties:
  DATABASE_URL: postgresql://...         # ✅ Runtime
  AUTH_SECRET: ...                       # ✅ Runtime
  AUTH_GITHUB_ID: ...                    # ✅ Runtime
```

---

## Quick Reference Card

### To Change Branding/Features → Rebuild Image
```bash
# 1. Edit Dockerfile ARG
vim Dockerfile
# 2. Rebuild
make build
# 3. Push & deploy
docker push registry/image:version
make helm-upgrade
```

### To Change Database/Auth → Update Helm Values
```bash
# 1. Edit values.yaml
vim helm-chart/values.yaml
# 2. Deploy (no rebuild needed)
make helm-upgrade
```

### Local Development (.env file)
```bash
# Create .env for docker-compose
cat > .env << 'EOF'
POSTGRES_USER=agentos_admin
POSTGRES_PASSWORD=password123
POSTGRES_DB=agentos_prompts
AUTH_SECRET=local-dev-secret-change-in-production-min-32-chars
AUTH_GITHUB_ID=your-github-client-id
AUTH_GITHUB_SECRET=your-github-client-secret
EOF

# Start
make compose-install
```

---

## Validation

### Check Build-Time Config (in Docker image)
```bash
# Run image and check generated prompts.config.ts
docker run --rm -it agentos-prompt-library:latest cat /app/prompts.config.ts

# Should show:
#   name: "AgentOS Prompt Library"
#   providers: ["github"]
#   privatePrompts: true
```

### Check Runtime Config (in Kubernetes pod)
```bash
# Check env vars in running pod
kubectl exec -it <pod-name> -- env | grep -E "DATABASE_URL|AUTH_"

# Should show:
#   DATABASE_URL=postgresql://...
#   AUTH_SECRET=...
#   AUTH_GITHUB_ID=...
```

### Common Mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Using `PCHAT_*` in Dockerfile ARG | Config not applied, defaults used | Use `BRAND_*`, `AUTH_PROVIDERS`, `FEATURE_*` |
| Setting branding in K8s ConfigMap | Changes ignored | Set in Dockerfile ARG, rebuild image |
| Missing `DATABASE_URL` at runtime | Container crashes on startup | Add to ConfigMap/Secret |
| Wrong `AUTH_PROVIDERS` format | Auth broken | Use comma-separated: `"github,google"` not `"github google"` |
| Forgot to run `docker-setup.js` | Using upstream defaults | Add RUN step in Dockerfile builder stage |
