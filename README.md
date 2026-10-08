# 🧠 Enterprise Agent OS (EAOS)

> 🚀 **Envisioning how future enterprises will run — with AI agents doing the work humans do today.**
>
> EAOS models a company as an **organization of AI agents**: a C-suite that sets direction, five regiments that execute, and a governance layer that keeps every decision auditable — so work flows from **intent to outcome** without a human driving each step.

EAOS is a **control plane for enterprise work**. You describe the outcome in plain language; an organization of agents decomposes it, routes it to the right specialists, executes it through your real tools, and hands back a reviewed, traceable result. It doesn't replace your tools — it **orchestrates** them: agents think and decide, skills and tools execute, workflows give structure, and humans stay in control through approvals and audit.

**Why it matters:** today software waits for a human to operate it. EAOS flips that — describe a goal, not a sequence of clicks; get an organization of agents, not a single chatbot; keep your tools and your governance. It runs in a safe **simulation mode** out of the box, and goes live the moment you add an API key.

> 🧩 *Think: "Kubernetes for Enterprise Workflows"* — Agents = Pods · Skills = Containers · Workflows = Deployments · MCP = Service Mesh · UTCP = API Schema.

<img width="660" height="562" alt="EAOS - Architecture" src="https://github.com/user-attachments/assets/d88b0629-bcb5-47aa-94b3-5844b47803f8" />


<img width="474" height="573" alt="EAOS - Conv path" src="https://github.com/user-attachments/assets/44fe7431-0603-40fa-a2fd-9b30749b0529" />


---

## ✨ Highlights

- 🤖 **53 autonomous agents** across 5 regiments (Titan · Olympian · Asgard · Explorer · Eden)
- 🏛️ **Military hierarchy** — General → Field Marshal → Colonel → Captain → Corporal
- 🧰 **60+ pre-built skills** spanning Engineering, Marketing, Product, HR, Talent, PMO
- 🔌 **MCP tool layer** with 8+ adapters (Jira, GitHub, Slack, Confluence, HubSpot, GA4, LinkedIn, Figma)
- 🔄 **A2A protocol** for agent-to-agent delegation, review, critique, escalation
- 📦 **UTCP packets** — universal task context standard for every execution
- 🧭 **5 flagship workflows** — PRD→Jira · Incident RCA · Campaign Launch · Hiring Pipeline · Launch Readiness
- 🎯 **Model router** — Haiku → Sonnet → Opus with cost metering & circuit breakers
- 🛡️ **Governance built-in** — RBAC, audit trail, compliance checks, cost attribution, budget controls
- 📊 **150+ API routes** — fully implemented backend with real persistence
- 🧩 **Skill Library** — adopted, file-defined EAOS skills (QA loop · security audit · PRD writer · technical spec · product discovery) runnable from the UI
- 🏛️ **Regiment Review** — collaborative Strategy → Design → Engineering → DevEx review chain where each stage sees the prior verdicts
- 🔌 **Real MCP client** — stdio + HTTP transports with graceful degradation (codebase-memory, voicebox)
- 🎬 **Guided onboarding + dark mode** — storytelling home, an "experience the magic" first-run flow, light/dark themes, and toast feedback
- 🔒 **Hardened security** — OIDC JWKS verification · mandatory JWT in prod · IDOR-scoped reads · CORS allowlist · safe expression eval · SkillSpector skill-scan gate

---

## 🧬 How It Works

```
You state a goal
  → Intent Engine selects the workflow
    → Agents collaborate (A2A) and run skills
      → Tools execute the work (MCP)
        → Outputs are aggregated and reviewed
          → Human approves → Memory + after-action report
```

Vision-level goals are **decomposed** by the C-suite and **cascaded** down through regiments to individual agents — the same loop scales from a single skill run to a cross-functional swarm.

---

## ⚡ Quick Start

```bash
# 📥 Clone and install
git clone https://github.com/Phani3108/EAOS.git
cd EAOS
pnpm install

# 🔐 Set up environment
cp .env.example .env
# Edit .env — set JWT_SECRET and EAOS_SETUP_TOKEN; add LLM keys for real execution

# ▶️ Run gateway + frontend
pnpm dev

# 🐳 Or use Docker
docker compose -f deploy/docker-compose.production.yml up -d
```

- 🌐 **Frontend** — http://localhost:3010
- 🛠️ **Gateway** — http://localhost:3000
- 📈 **Grafana** — http://localhost:3001

### Current release scope and authentication

- Canonical execution uses versioned definitions, stable identities and explicit live/simulated/unsupported outcomes. PostgreSQL mode uses transactional run/job admission, fenced worker leases, durable approval continuations and a tenant-scoped outbox. The broader capability inventory remains unverified until its adapters and business workflows pass conformance checks.
- Set `JWT_SECRET` and `EAOS_SETUP_TOKEN` before first startup. Open the browser sign-in screen, choose first-time administrator setup, and save the API key shown once. Anonymous access is off by default.
- Docker requires `POSTGRES_PASSWORD`, `GRAFANA_PASSWORD`, a migration-owner `MIGRATION_DATABASE_URL`, and a separate application-role `DATABASE_URL`. It runs tracked migrations before the gateway. Production refuses owner/superuser/BYPASSRLS application roles. Provision the application login through your database administrator after migrations; use TLS for a public deployment.
- `EAOS_TENANT_ID` binds legacy state and bootstrap configuration, not ownership of other tenants' canonical runs. Canonical APIs enforce verified tenant/owner scope. In PostgreSQL mode, unmigrated legacy writes are rejected and snapshot restoration is read-only. `GET /api/runtime/quarantine` provides an administrator-only dry-run summary; existing data is never reassigned automatically.
- Browser traffic uses the same-origin `/_/gateway` proxy. Set `FRONTEND_URL` and `CORS_ALLOWED_ORIGINS` to the public web origin; set `GATEWAY_URL` to that origin plus `/_/gateway`. Organization sign-in also needs the OIDC variables and an `OIDC_REDIRECT_URI` ending in `/_/gateway/api/auth/oidc/callback` on the web origin.
- Sign-in, demo and SSO calls are rate limited per client. Behind the `/_/gateway` proxy the gateway sees the web server's address for every visitor, so list the web tier in `EAOS_TRUSTED_PROXIES` (IPs or CIDR blocks) and have the TLS terminator in front of it set `X-Forwarded-For`; nothing else is trusted to name a client.
- `pnpm dev` runs `EAOS_DEMO_MODE=local` with both servers bound to 127.0.0.1 (`HOST`). Local demo mode honours a credential-less request only from this machine — loopback client, localhost `Host`, no foreign browser `Origin`. Demo identities stop working when their mode is turned off.
- API-key rotation/revocation ends the owner's issued sessions. Save the replacement before signing back in. Keep an independent `API_KEY_HASH_SECRET` for long-lived key hashes when rotating JWT signing keys; keys issued before it was set keep working and move onto it on first use. A key, or a session minted from one, cannot mint a credential that outlives the key's `expiresAt`.

Application-role grants after migration (replace `eaos_app` with the separately provisioned login; do not give it schema ownership):

```sql
GRANT USAGE ON SCHEMA public TO eaos_app;
GRANT SELECT, INSERT, UPDATE ON tenants, users, setup_state, deployment_identity, browser_auth_sessions TO eaos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO eaos_app;
GRANT SELECT, INSERT, UPDATE ON runtime_definitions, runtime_runs, runtime_jobs, runtime_steps, runtime_attempts, runtime_approvals, runtime_artifacts, runtime_events TO eaos_app;
GRANT SELECT, INSERT, UPDATE ON workspace_records, workspace_chat_sessions, workspace_chat_messages, workspace_connections TO eaos_app;
GRANT SELECT, INSERT, UPDATE ON runtime_usage_budgets, runtime_usage_reservations, runtime_step_attempts, runtime_artifact_parents, runtime_schedules, runtime_trigger_receipts, runtime_deliveries, runtime_agent_leases, runtime_children TO eaos_app;
GRANT SELECT, INSERT, UPDATE ON input_artifacts, runtime_input_artifacts, runtime_tool_receipts TO eaos_app;
GRANT SELECT, INSERT ON integration_audit, platform_audit, runtime_connector_observations TO eaos_app;
GRANT SELECT, INSERT, UPDATE ON platform_http_metrics, platform_datasets, platform_evaluations, platform_registry_packages, platform_registry_versions, platform_record_reviews, platform_memberships, platform_event_offsets TO eaos_app;
GRANT SELECT ON kv_store TO eaos_app;
GRANT SELECT, INSERT ON audit_log TO eaos_app;
GRANT EXECUTE ON FUNCTION authenticate_api_key(TEXT), touch_api_key(TEXT), runtime_ancestors_active(TEXT,TEXT), runtime_actor_active(TEXT,TEXT,JSONB) TO eaos_app;
```

File-backed mode remains an isolated local-development fallback, not a multi-worker durability guarantee. Canonical orchestration requires PostgreSQL and migrations through 024. Workers execute bounded parallel DAG nodes with serialized, fenced checkpoints; a coordinator parks only after active siblings settle. Completed nodes cannot move backwards, and interrupted unknown effects require reconciliation rather than automatic replay. Supported text uploads resolve through owner-scoped artifact records. Nonmigrated connector effects and unsupported file formats remain explicitly unsupported rather than borrowing credentials or fabricating extracted content.

Migrated storage/API contracts:

- Knowledge documents, private memory decisions/corrections and configuration records use owner-scoped, version-checked writes. Updates require the current `version`; stale updates return conflict instead of overwriting.
- Chat sessions/messages are persisted and owner-scoped. PostgreSQL chat replies and structured `/skill-slug {"input":"value"}` commands submit canonical executions; the chat acknowledgement links the run rather than claiming a completed reply.
- Connections accept `secretRef: {provider, path, key?, version?}` plus an explicit resource/action `config`. Vault KV v2 is the implemented resolver; other stored provider references are not executable adapters. Configure paired `VAULT_ADDR` (HTTPS origin), `VAULT_TOKEN`, and optional `VAULT_KV_MOUNT` (default `secret`). Paths must start with the verified `tenantId/userId/`; secret fields default to `token`. Jira stores a JSON string with `email` and `apiToken` in that field. No secret values are returned by connection APIs.
- Saving a reference yields `configured`; `POST /api/connections/:id/test` verifies identity and configured resource access. GitHub config uses `repositories` and action names such as `read:pull_request` / `comment:pull_request`; Jira uses `endpoint`, `projects`, and `read:issue` / `create:issue`; Slack uses `channels` and `read:message` / `create:message`. Defaults authorize reads only. Connection verification is not proof of every write permission.
- Current typed transport coverage is GitHub PR evidence/comment, Jira single-issue read/create, and Slack message read/create. Effect approval binds normalized inputs and credential version; durable receipts prevent blind duplicate writes, and remote readback is required for success. Unknown effects remain inconclusive pending reconciliation. Vault rotation/version or binding-key changes invalidate verification. Keep an independent `API_KEY_HASH_SECRET` for stable credential bindings across JWT rotation.
- The new Vault/connector transport enforces exact HTTPS origins, DNS/IP validation and pinning, no redirects, response/body bounds and timeouts. Only the operator-configured Vault origin may use private addresses; tool targets may not. Legacy transports remain contained, not advertised as conforming.
- An operator configures a tenant usage budget with `PUT /api/runtime/usage` and `limitMicros` (1,000,000 units = USD 1). Live provider requests reserve budget before dispatch. Successful responses settle estimated token cost; uncertain failures retain reservations rather than inventing zero cost. Simulation does not consume live budget.
- Schedules use validated five-field cron with an explicit IANA timezone (UTC by default), intervals, one-time or named event triggers. DST gaps are skipped and repeated fall-back wall-clock occurrences run once. New API schedules default to overlap skipping; existing unspecified policies retain compatibility. Missed occurrences coalesce rather than replaying an unbounded backlog. Event bindings map bounded string payload paths into declared text inputs. Run/event requests require a stable `deliveryId`; receipts and run admission commit together. Toggle/archive requests require `version`. Dispatch rechecks current membership/scopes.
- `GET /api/executions/:id/trace` exposes authorized step attempts, artifact metadata and lineage. `POST /api/executions/:id/retry` is operator-only and does not replay rejected approvals or uncertain effects.
- Recursive subworkflows admit child run + parent-step linkage in one transaction, inherit owner/mode/deadline, and resume parents durably. Limits are five child levels, 128 runs per tree, and 1,024 expanded definition nodes. Parent cancellation fences all active descendants; cross-run artifact lineage is retained.
- Goal, SOMAN/pipeline and swarm compatibility routes now submit/read/cancel canonical runs. Natural-language planning uses a frozen authorized skill manifest and rejects invented agents/skills before child admission; simulated goals require an explicit task plan. Swarm phases are real child runs, and advancement authorizes a waiting gate rather than fabricating phase completion.
- SOMAN feedback uses bounded child iterations and durable cooldowns. Prior-iteration state is separate from ordinary DAG dependencies. Required sections/citation presence are checked mechanically; semantic quality/circuit-breaker requirements remain human gates, not claimed factual certification. Live vendor activation remains M4 work.
- Approval decisions remain durable while sibling nodes run. Required confirmation fields and designated approvers are enforced, and approved drafts are reused. Per-node retries/deadlines and explicit whole-tree deadlines are bounded; suspension does not occupy workers.
- `WorkflowRunner` requires an authenticated `WorkflowClient`; `GatewayWorkflowClient` uses `POST /api/workflows/execute` plus canonical read/decision/cancel APIs. `GatewayWorkflowBridgeClient` supports the older workflow-engine shape through the same service. Arbitrary worker IDs, untyped tool actions, implicit failure skipping and executable hooks are rejected rather than converted to no-ops. The legacy runner is retained only for isolated characterization, not exported as the SDK default.

M4/M5 acceptance boundaries:

- `POST /api/artifacts` (also the marketing upload alias) accepts `{fileName,mimeType,contentBase64}`. UTF-8 text, Markdown, CSV, JSON and source code are supported. Limits: 512 KB raw bytes, 128k extracted characters, 64k expanded execution context, 20 references per run, and 64 MB/1,000 stored files per owner. PDF/Office/image extraction is not implemented. Download and archive operations enforce ownership; run admission pins artifact digests.
- Structured artifact evidence reaches the model as JSON, not `[object Object]`. Changing fixture source content changes the observed model output in the controlled-provider gate. Simulation does not imply that an external action occurred.
- `GET /api/certification` and catalog support fields distinguish content generation, typed external actions, and missing bindings. `POST /api/workflows/inspect-yaml` parses bounded YAML and reports compiled or unsupported starters; unknown workers/actions are not guessed. Legacy starters with unresolved bindings remain unsupported.
- `pnpm test:m4` and `pnpm test:m5` run the combined disposable-database regression suite. The M5 matrix checks every catalog definition and all five flagships in simulation, plus representative six-family mocked content lifecycles. Vendor-sandbox completion proofs and human domain review remain pending by explicit user choice. These automated results do not certify six live external-operation verticals or every legacy action binding.

M6/M7 operating and developer core:

- `GET /api/operations/summary` derives authenticated-request counts/latency, live versus simulation outcomes, job state, usage ledger totals and labeled evaluation observations from PostgreSQL. Empty quality data stays null. Legacy random fingerprints are no longer an advertised measurement source.
- `GET /api/operations/jobs` and the Operating Platform console expose unresolved work with authorized trace, eligible retry and recursive cancellation controls. Unknown effects cannot be forced to complete. `GET /api/operations/events?cursor=...` provides tenant/owner-scoped replay with a durable per-tenant sequence assigned after business commits; use event IDs to deduplicate at-least-once live delivery. Redis fanout remains deployment-specific.
- Versioned datasets contain labeled cases, explicit readers and run-linked observations. A promotion requires current, complete live evidence for at least three distinct labeled cases, a passing review, an independent reviewer, and an administrator CAS activation. This is a governance floor, not statistical or vendor/business certification. Dataset/source revision or access changes invalidate stale evidence.
- Knowledge/memory retrieval uses unexpired owner-requested independent reviews, explicit readers and current source versions. Memory promotion requires a completed live source run. `knowledgeQuery` resolves reviewed sources into bounded, cited user context; legacy global agent memories are not injected into PostgreSQL execution. Current retrieval is full-text, not a claim of complete connector/vector ingestion.
- Notifications use owned terminal source runs and enabled Slack channels through canonical approved tool runs. Delivery state comes from the verified receipt, not a counter increment. Simulation cannot enqueue a live notification. New email/Teams/voice channels and billing activation remain disabled.
- The canonical PostgreSQL registry is authoritative for runtime prompt versions. `/api/prompts` stages prompt-backed workflow candidates and lists only active reviewed versions; old prompt-library/editorial records are not reassigned or automatically imported. Candidates can be previewed by their publisher/designated evaluators before promotion. Private/tenant visibility, origin/license metadata, immutable hashes, independent review, activation and rollback-by-version share the same registry. Connector manifests stay non-executable while vendor certification, independent connector review and marketplace execution binding remain pending.
- Tenant membership updates are admin-only, version-checked and audited; they revoke issued sessions and attenuate existing credentials. Active runs and stream delivery recheck membership; the last active administrator cannot be removed. This manages existing tenant principals, not an unimplemented invitation or billing flow.
- `PlatformClient` adds typed operations/evaluation/registry/member APIs. The CLI uses `EAOS_TOKEN` or `EAOS_API_KEY` without persisting them. `run` defaults to simulation; `--live` is explicit. Commands include `ops`, `recovery`, `validate`, `run`, `watch`, `trace`, `export`, `approve`, `reject`, `cancel`, `retry`, `events`, `dataset-create`, `evaluate`, `stage`, `preview`, `review`, `activate`, `prompt-stage`, `members`, and `member-update`. JSON output can be redirected for reviewable evidence exports.
- These core capabilities do not close the remaining M4/M5 certification gaps or all enterprise expansion. Connector marketplace activation, broader ingestion/retention/billing workflows and production operational certification remain explicitly gated.

Connector conformance before marketplace activation:

- The six native GitHub/Jira/Slack actions have registered input/output schemas. `GET /api/registry/connectors` exports their contracts, policies and adapter fingerprints; registration is not a certification claim. Resource probes verify the requested repository/project/channel identity. Jira project/parent and GitHub comment-target readback are checked, and Slack requires an unambiguous matching message.
- GitHub PR evidence uses immutable base/head commit comparisons. The supported text-diff boundary is 100 files and 100 comparison commits; missing patches, inconsistent line counts and incomplete comparisons fail explicitly. Binary/oversized evidence is not silently represented as a complete review input. Connector outputs are bounded to 128k serialized characters; HTTPS transport bounds include DNS resolution and cancellation.
- Connector staging accepts `{schemaVersion:1,id,actions}` for registered native IDs and seals it as a version-2 manifest. Duplicate, unknown and cross-connector actions are rejected. Adapter fingerprints bind schemas/policies and the gateway adapter/transport implementation; changed builds require restaging and invalidate pending action approval proofs. Existing completed receipts remain historical results, not newly generated certification evidence.
- Migration 024 adds fenced, tenant-owned observations for successful reads and verified effects. Effects persist observations with their completed receipt in one transaction. Simulated work, mismatched frozen actions and effects without verified receipts cannot manufacture observations. Custom/injected transports are always labeled `custom_transport`; `native_transport` means the native HTTPS path was used, not that an authorized vendor sandbox certification was performed.
- `GET /api/registry/packages/:id/conformance?hash=...` returns authorized per-action observations bound to the exact manifest/adapter, canonical completed run/step and current connection version. It considers a 90-day evidence window and returns blockers, not a fabricated certification flag. No HTTP endpoint accepts caller-authored pass/native-evidence claims. Old/unpinned manifests require restaging. Revoked connections and changed adapters invalidate current evidence eligibility.
- `PlatformClient.connectorContracts()` / `connectorConformance()` and CLI `connector-contracts` / `conformance <packageId> <hash>` expose this state. The conformance command exits nonzero while activation is blocked; the registry UI shows the same blockers. Generic workflow evaluation, preview, review and activation cannot enable a connector version.
- **Marketplace connector activation remains disabled.** The local contract/failure matrix does not replace vendor-sandbox certification, independent connector approval, publisher-origin attestation or an activation-time execution binding. The 24 unbound catalog workflows and 15 unsupported legacy starters are not silently repaired or certified by this work. External tests and real vendor actions still require specific authorization.

### Verification

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` run the build, type checks, lint and actual root unit suites.
- `pnpm audit --prod --audit-level=high` is a blocking release check.
- `EAOS_TEST_DATABASE_URL=... pnpm test:m0` requires a disposable local PostgreSQL database named `eaos_m0_fixture`; it refuses to silently skip. It tests migrations, bootstrap, RLS, key/session lifecycle and the compiled gateway.
- `EAOS_TEST_DATABASE_URL=... pnpm test:m2` requires a disposable local PostgreSQL database named `eaos_m2_fixture`. It checks non-owner RLS, admission rollback/idempotency, concurrent claims/fencing, retry delay, cancellation, approval expiry/resume, outbox delivery, two-tenant HTTP isolation, restart recovery and unavailable-storage liveness. It creates fixture rows and roles; never point it at customer data.
- `EAOS_TEST_DATABASE_URL=... pnpm test:m3` runs the combined M2/M3 gate against `eaos_m2_fixture`, including recursive cancellation/deadlines, monotonic checkpoints, primary parallel overlap with a controlled fake provider, process-kill recovery, parallel approvals, full SOMAN/swarm flows, planner validation and authenticated SDK/bridge parity. It does not call real vendors.
- `EAOS_TEST_DATABASE_URL=... pnpm test:m6` / `pnpm test:m7` run the combined fixture gate, including measured operations, governance/promotion denials, membership revocation, SDK/CLI behavior, notifications, event bindings/replay, and two gateway processes sharing PostgreSQL. The measured fixture load is not a production capacity promise.
- If a managed macOS certificate chain prevents the pinned Playwright browser download, use Node's existing system CA store for that command (`NODE_OPTIONS=--use-system-ca pnpm exec playwright install chromium`); never disable TLS verification.
- `pnpm exec playwright install chromium` then `pnpm test:browser` tests the production browser/proxy authentication flow and six-persona execution contract using isolated fixture servers on ports 32198/32199. Build workspace dependencies first. Browser tests never use real vendor credentials.

### ✅ Prerequisites

- 🟢 Node.js >= 22.20.0 (Docker/CI pin 22.23.2)
- 📦 pnpm >= 9.0.0

---

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 14)                 │
│  Sidebar │ Command Palette │ Main Content │ Right Panel  │
├──────────┴─────────────────┴──────────────┴─────────────┤
│                    Gateway API (Node.js)                 │
│  150+ API routes │ JWT Auth │ Event Bus │ WebSocket      │
├─────────────────────────────────────────────────────────┤
│              Agent Hierarchy (53 Agents)                 │
│  Titan │ Olympian │ Asgard │ Explorer │ Eden Regiments   │
├─────────────────────────────────────────────────────────┤
│  C-Suite Layer │ Vision/PMO │ Innovation │ Budget/Cost   │
├─────────────────────────────────────────────────────────┤
│  Persistence: File-backed │ PostgreSQL │ In-Memory       │
│  Event Bus │ Notification Dispatch │ Webhook Connector   │
├─────────────────────────────────────────────────────────┤
│  Connectors: Jira │ GitHub │ Slack │ Teams │ HubSpot     │
└─────────────────────────────────────────────────────────┘
```

### 🪖 Organizational Hierarchy

- 🏛️ **Board / Vision Layer**
  - 👑 **CEO** — Supreme Commander · Titan Regiment
    - 📣 **CMO** → Olympian Regiment (Marketing)
    - 🛠️ **CTO** → Asgard Regiment (Engineering)
    - 📐 **CPO** → Explorer Regiment (Product)
    - 🧑‍💼 **CHRO** → Eden Regiment (HR & Talent)
    - 💰 **CFO** → Budget Intelligence
    - 📋 **PMO** → Program Management Office

---

## 🧱 Tech Stack

| Layer | Technology |
|---|---|
| 🎨 **Frontend** | Next.js 14 · React 18 · TypeScript · Tailwind · Zustand · Framer Motion |
| 🛣️ **Gateway API** | Node.js HTTP server · TypeScript |
| 🗄️ **State** | Zustand |
| 🔄 **Data Fetching** | TanStack React Query |
| 📦 **Monorepo** | pnpm workspaces · Turborepo |
| 📐 **Schemas** | JSON Schema (skills · tools · prompts · workflows · workers · policies) |
| 🐘 **Database** | PostgreSQL (Prisma for Prompt Library) |
| 🤖 **Agent Runtimes** | LangGraph (default) · AutoGen · CrewAI · Custom |
| 🔌 **Connectors** | Jira · GitHub · Slack · Confluence · Teams |

---

## 📂 Project Structure

```
EAOS/
├── 🎨 apps/web/                # Next.js 14 frontend (App Router · Tailwind · Framer Motion)
├── 🛣️ services/
│   ├── gateway/                # API gateway (Node.js HTTP, 150+ routes) — the runtime core
│   ├── cognitive-engine/       # Multi-step LLM reasoning pipeline
│   └── memory/                 # Memory service
├── 📦 packages/                # 28 packages (schemas · auth · workflow-engine · memory-pipeline · router · policy · db · sandbox…)
├── 🧩 skills/                  # File-defined EAOS skills by persona (design · engineering · hr · product · program · marketing · leadership · learning)
├── 🗃️ skills-unported/         # Quarantined skills pending EAOS-native rewrite
├── 🔌 connectors/              # GitHub · Jira · Slack · Teams
├── 👷 workers/                 # developer-knowledge · incident-intelligence · engineering · marketing · leadership · transcript-actions
├── 🤖 agents/marketing/        # Marketing Agent Graph (SOMAN)
├── 🔄 workflows/               # Flagship cross-functional workflow DAGs
├── 🧠 third_party/             # Adopted-OSS notices + licenses (deer-flow · hermes · gstack · mattpocock)
├── 📚 prompt-library/          # Prompt Library (Prisma-based)
├── 🔌 mcp.servers.json         # MCP server registry (stdio + HTTP)
└── 📸 docs/screenshots/        # App screenshots
```

---

## 🛣️ API Endpoints (150+)

| Group | Routes | Description |
|---|---|---|
| 🔐 **Auth** | `POST /api/auth/token` · `GET /api/auth/me` | JWT issuance & user info |
| ▶️ **Execution** | `POST /api/execute` · `GET /api/executions[/:id]` | Unified skill execution |
| 👔 **C-Suite** | `GET /api/csuite[/:id[/chain]]` | Agent hierarchy & command chain |
| 🎯 **Vision/PMO** | `POST /api/vision[/:id/decompose,cascade]` | Vision decomposition & cascading |
| 🧪 **Innovation** | `/api/innovation/{experiments,hackathons,graduations}/*` | Innovation labs CRUD + state |
| 💰 **Budget** | `/api/budget/{agents,spend,alerts,dashboard}/*` | Cost tracking & CFO dashboard |
| 📈 **Improvement** | `/api/improvement/{reviews,plans,feedback,exemplars}/*` | Reviews · plans · feedback |
| 🔔 **Notifications** | `/api/notifications/{channels,rules,dispatch}/*` | Multi-channel dispatch |
| 🔗 **Webhooks** | `/api/webhooks/{endpoints,subscriptions,receive}/*` | HMAC-SHA256 signed |
| 🧩 **Skills** | `/api/skills/unified` · `/api/marketplace/skills/*` | Marketplace with voting |
| 🪟 **Personas** | `/api/{engineering,product,hr,marketing}/*` | Persona-gated execution |
| 🤖 **Agents** | `/api/agents/{registry,kpis,memory}` | Registry · KPIs · memory |
| ⏰ **Scheduler** | `/api/scheduler/{jobs,events}/*` | Cron / interval / event-driven |
| 💬 **Blog/Forum** | `/api/{blog/posts,forum/threads}/*` | Content with voting |
| 🧠 **Cognitive** | `/api/cognitive/{process,decompose,reason}` | Multi-step LLM pipeline |
| 🔍 **Observability** | `/api/{governance/audit,events,health}` | Audit · events · health |
| 🧩 **Skill Library** | `/api/skills/fs[/execute]` · `/api/skills/scan` | File-defined skills + scan gate |
| 🏛️ **Review** | `/api/review/{run,chain}` | Collaborative Regiment Review chain |
| 🔌 **MCP** | `/api/mcp/{servers,tools,execute,stats}` | Real MCP client (stdio + HTTP) |
| 🐝 **Swarms** | `/api/swarms/{launch,templates,stats}` | A2A swarm orchestration |

---

## 🌐 Marketing Agent Graph (SOMAN)

The **Self-Optimizing Marketing Agent Network** — a collaborative agent system reasoning through shared state:

```
                     🧭 Marketing Orchestrator
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
   🔍 Research          🎯 Strategy          📊 Analytics
         │                    │                    │
         ├──────────┐         │         ┌──────────┤
         │          │         │         │          │
    🔎 SEO    🥊 Competitor   │   ✍️ Copy   📣 Campaign
                              │      │
                              │  🎨 Design
                              │      │
                       📧 Email · 🛬 Landing Page
                                │
                       🔁 Optimization Agent ◀── Feedback Loop
```

🔁 **Optimization loop:** Campaign → Performance Signals → Analytics → Optimization → Strategy Adjust → Creative Regen → New Campaign

---

## 📐 Schemas

All definitions are validated against JSON schemas in `packages/schemas/`:

- 🧩 `skill.schema.json` — Skill definitions
- 🔌 `tool.schema.json` — Tool connectors
- 📚 `prompt.schema.json` — Prompt library entries
- 🔄 `workflow.schema.json` — Workflow definitions
- 👷 `worker.schema.json` — Worker configurations
- 📡 `event.schema.json` — Event types
- 🛡️ `policy.schema.json` — Policy rules
- 🌐 `capability-graph.schema.json` — Tool capability graph

---

## 🧠 Adopted Open Source

EAOS harvests and adapts best-in-class open-source agent tooling into EAOS-native form (full notices in `third_party/NOTICE`):

| Source | Adopted as |
|---|---|
| **bytedance/deer-flow** | Orchestrator prompt (live in the swarm path) + AgentMemory schema |
| **Hermes Agent** | Best-practice agent use cases |
| **gstack · mattpocock skills** | Curated, EAOS-renamed entries in the Skill Library |

> 🧩 Adopted artifacts use **EAOS nomenclature**, not source-repo names, so the platform speaks one consistent language.

---

## 📜 License

MIT

---

## 👤 Author

**Created & developed by [Phani Marupaka](https://linkedin.com/in/phani-marupaka)**

© 2026 Phani Marupaka. All rights reserved.

> ⚖️ Unauthorized reproduction, distribution, or modification of this software, in whole or in part, is strictly prohibited under applicable trademark and copyright laws including but not limited to the Digital Millennium Copyright Act (DMCA), the Lanham Act (15 U.S.C. § 1051 et seq.), and equivalent international intellectual property statutes. This software contains embedded provenance markers and attribution watermarks protected under 17 U.S.C. § 1202. Removal or alteration of such markers constitutes a violation of federal law.

---

🛠️ Built with **Next.js · TypeScript · Tailwind CSS** — and a lot of AI agents. 🤖✨
