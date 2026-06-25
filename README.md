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
cp deploy/.env.example .env
# Edit .env — add at minimum: ANTHROPIC_API_KEY

# ▶️ Run gateway + frontend
pnpm dev

# 🐳 Or use Docker
docker compose -f deploy/docker-compose.production.yml up -d
```

- 🌐 **Frontend** — http://localhost:3010
- 🛠️ **Gateway** — http://localhost:3000
- 📈 **Grafana** — http://localhost:3001

### ✅ Prerequisites

- 🟢 Node.js >= 20.0.0
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

## 🌟 Features

### 🔧 Core Platform
- 🤖 **53 Autonomous Agents** across 5 regiments
- 🪖 **Military Hierarchy** — General → Field Marshal → Colonel → Captain → Corporal
- 🛣️ **150+ API Routes** — fully implemented backend with real persistence
- 🔐 **JWT Authentication** — role-based access with persona gating
- 📡 **Event Bus** — in-process pub/sub with pattern matching & dispatch
- 🔄 **WebSocket Streaming** — live execution updates pushed to UI
- 💾 **Three-Tier Persistence** — File-backed JSON · PostgreSQL · In-Memory

### 👔 C-Suite & Vision Layer
- 🎯 **C-Suite Command Center** — CEO, CMO, CTO, CPO, CHRO command their regiments
- 🧠 **Vision & Strategy** — LLM-powered vision decomposition into objectives
- 📥 **Cascading** — objectives flow C-Suite → regiment → agents
- 📋 **PMO Dashboard** — cross-regiment status rollups & program management

### 🏢 Persona Hubs
- 📣 **Marketing** — 30 workflows: Campaign · Content · Creative · Event · Research · Analytics
- 🛠️ **Engineering** — PR Review · Unit Tests · Incident RCA · Architecture Review · 6 more
- 📐 **Product** — PRD Generator · Jira Epics · User Stories · Roadmaps · 6 more
- 🧑‍💼 **HR & Talent** — Recruiting · onboarding · performance reviews · talent analytics

### 🧪 Innovation Labs
- 🔬 **Experiment Sandbox** — create, activate, evaluate, graduate experiments
- ⏱️ **Hackathon Mode** — time-boxed innovation sprints
- 🎓 **Graduation Pipeline** — promote successful experiments to production

### 💰 Budget & Cost Intelligence
- 🪙 **Per-Agent Budgets** — monthly · quarterly · annual allocation
- 📊 **Spend Tracking** — every API call logged with cost, tokens, model, latency
- 🔥 **Burn Rate Analysis** — daily/weekly averages, month-end projections
- 🚨 **Cost Alerts** — threshold, overspend, spike alerts with severity levels
- 🧮 **CFO Dashboard** — total spend, by-regiment breakdown, top spenders

### 📈 Agent Training & Continuous Improvement
- ⭐ **Performance Reviews** — reliability · efficiency · quality · collaboration · cost
- 🎯 **Improvement Plans** — objective-based with metric tracking & auto-completion
- 💬 **Feedback Loops** — positive/negative/correction with sentiment trends
- 📚 **Training Exemplars** — curated executions for agent learning
- 🩺 **Health Reports** — agents needing attention, outcome distributions

### 🔔 Notifications & Webhooks
- 📨 **Multi-Channel Dispatch** — Slack · Teams · Email · Webhook
- 🧠 **Rule Engine** — trigger-based notification routing
- 🔗 **Webhook Connector** — inbound/outbound with HMAC-SHA256 signatures
- 📜 **Delivery Logs** — full audit trail of every notification

### 🛠️ Platform Operations
- 🛒 **Skill Marketplace** — CRUD with voting, comments, analytics, governance
- ⏰ **Scheduler** — cron · interval · event-driven · one-time jobs
- 💬 **Discussion Forum** — threaded conversations with voting & answer acceptance
- ✍️ **Blog Editor** — publish, manage, track engagement
- 📚 **Prompt Library** — fork, pin, upvote curated prompts
- 🔌 **Tool Registry** — manage external connections with OAuth & API key auth

### 🤝 Collaboration, Skills & Integration
- 🧩 **Skill Library** — adopted, file-defined EAOS skills runnable from the UI (`POST /api/skills/fs/execute`)
- 🏛️ **Regiment Review** — Strategy → Design → Engineering → DevEx review chain over shared context
- 🔌 **Real MCP Client** — `@modelcontextprotocol/sdk` over stdio + HTTP, dynamic tool discovery, graceful fallback
- 🐝 **A2A Swarms** — ephemeral agent swarms with a real LLM discussion thread and inbox
- 🧠 **Adopted Orchestration** — deer-flow Orchestrator prompt (live in the swarm path) + AgentMemory schema

### 🎨 Experience & Onboarding
- 🎬 **Guided First-Run** — connect LLM → connect tool → run first skill, with a celebration on completion
- 📖 **Storytelling Home** — animated "How EAOS Works" flow + a real-progress Get-Started checklist
- 🌗 **Dark Mode** — full light/dark theming that honors `prefers-color-scheme`
- 🔔 **Toast Notifications** — non-blocking feedback replacing modal alerts, with a persistent bell history
- 🧭 **Guided Tour** — spotlight walkthrough with resolved anchors across the app

### 🔍 Observability, Governance & Security
- 🧾 **Audit Trail** — every action, handoff, decision logged immutably
- 💸 **Cost Attribution** — per-persona · per-agent · per-task breakdown
- 🔬 **Execution Traces** — token usage, latency, confidence metrics
- 📑 **After-Action Reports** — auto-generated per workflow execution
- 🔐 **Production Hardening** — OIDC JWKS id-token verification · mandatory JWT in prod · IDOR-scoped execution reads · CORS allowlist · safe expression evaluator (no `new Function`)
- 🧪 **Skill-Scan Gate** — SkillSpector-backed scan blocks malicious skills at registration (`POST /api/skills/scan`)

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

## 🎬 Running the App

Start the Gateway API and Frontend in two terminals:

```bash
# 🛣️ Terminal 1 — Gateway API (port 3000)
cd services/gateway
npx tsx src/server.ts

# 🎨 Terminal 2 — Frontend (port 3010)
cd apps/web
pnpm dev
```

🌐 Open [http://localhost:3010](http://localhost:3010)

> 👋 First time? A storytelling Home greets you with a **Get Started** checklist and a guided **"Run my first skill"** flow (connect an LLM → connect a tool → run a skill → celebrate). Replay it — or the guided tour — anytime from **Settings → Help & Learning**, and toggle **dark mode** in **Settings → Appearance**. ⌨️ Arrow keys navigate · Esc skips · Enter advances.

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
