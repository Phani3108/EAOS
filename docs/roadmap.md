# EAOS roadmap

The product is defined in [product/definition.md](product/definition.md). This roadmap delivers it in two parallel tracks. The **experience track** (U0–U5) rebuilds the web app around one loop: delegate → agents run → a human approves → audited outcome. The **platform track** (P3–P8) hardens the runtime, deploys it, and spins capabilities off as open MCP products.

```
P0  Land the hardening work (durable Postgres runtime, identity, integrations) + reconcile demo/simulation
 │
 ├─ Experience  U0 foundation & truth ─▶ U1 delegate & watch ─▶ U2 approve ─▶ U3 library & regiments ─┐
 │                                                              U4 govern & automate (parallel to U3) ┼▶ U5 insights & legacy removal
 └─ Platform    backend gaps G1–G16 (one slice ahead) · P3 runtime leftovers · P5 split deploy ·
                P6 core extraction (@eaos/*) · P7 five MCP products · P8 open-core release
 Every PR: blocking CI · axe 0 serious/critical · E2E core loop · size budgets · knip (no dead code)
```

## Definition of done: "complete working mode"

1. **Demo with no keys.** `pnpm dev` with no API keys: Try the demo → run any skill or flagship workflow, **simulated and labelled** → it pauses at a gate → approve in the UI → it completes with outputs and an audit entry, **in under 3 minutes**.
2. **Live with a key.** With an LLM key and a budget, the same flow runs live, with real tokens and cost.
3. **Restart-safe approvals.** Restart the gateway mid-approval: the gate is still pending, approving resumes the run, and the audit chain verifies.
4. **Production sign-in.** Production requires sign-in (API key or OIDC). The public demo is optional and always simulated.
5. **No fabricated data.** Every screen shows real data or an honest empty state.
6. **Accessible.** WCAG 2.2 AA, with axe reporting 0 serious or critical issues on every route.

## Experience track

| Slice | Delivers | Replaces (deleted in the same slice) |
|---|---|---|
| **U0 Foundation & truth** | <ul><li>Design tokens, with a dark theme driven by variables.</li><li>shadcn/ui on Radix.</li><li>App shell with role-aware navigation and ⌘K.</li><li>Real URL routes.</li><li>One same-origin typed client.</li><li>next-intl, plus a pseudo-locale.</li><li>Truthful `/welcome` page.</li></ul> | Blog, Discussions, about 11.6k lines of dead code, hardcoded counts, seeded notifications, sample chat, no-op settings, direct `localhost` calls, tour |
| **U1 Delegate & watch** | <ul><li>Run composer with preflight.</li><li>Runs table.</li><li>Run detail with a live timeline.</li><li>Home ("My work").</li><li>A single status and mode language.</li><li>WebSocket updates instead of polling.</li></ul> | Per-hub run screens, the browser-only run history, the separate execution views, chat |
| **U2 Approve** | <ul><li>Approvals inbox.</li><li>Approval card with confirmations, digest check and expiry.</li><li>Notifications.</li></ul> | Scattered approval UIs, seeded notification centre |
| **U3 Library & Regiments** | <ul><li>One catalogue with readiness.</li><li>Skill detail (Flow, Quality, Versions).</li><li>Knowledge.</li><li>Regiments and agent profiles with rank, chain of command and real metrics.</li><li>Meeting and Swarm as run modes.</li></ul> | 4 competing catalogues, the 6 persona hubs, the hardcoded agent directory |
| **U4 Govern & automate** | <ul><li>Usage and budgets.</li><li>Members and roles.</li><li>Audit.</li><li>Operations.</li><li>Connection wizard (Vault references).</li><li>Automations.</li><li>Policies.</li></ul> | JSON-textarea console, connector detail pages, tool registry, settings panel |
| **U5 Insights & legacy removal** | <ul><li>Team, operations and executive insights from real data.</li><li>Labs.</li><li>Performance pass.</li></ul> | C-Suite and Vision dashboards, the legacy screen host |

## Platform track

| Phase | Scope |
|---|---|
| **Backend gaps (G1–G16)** | <ul><li>Durable approvals inbox and a regiment-scoped `approver` role.</li><li>Run-list filters and preflight.</li><li>Realtime event contract.</li><li>Catalogue fields, readiness and input schemas.</li><li>Registry metrics.</li><li>One audit endpoint.</li><li>Notifications.</li><li>Autonomy and spend enforcement by rank.</li><li>Escalation and SLA.</li><li>After-action reports on Postgres.</li></ul> |
| **P3 Runtime leftovers** | <ul><li>Retried audit persistence.</li><li>Bounded and persisted agent-to-agent (A2A) state.</li><li>OIDC scopes from identity-provider groups.</li><li>Auth state moved to Postgres, so the gateway can run multiple replicas.</li><li>The work-items feature (`feat/work-items`) revived with least-privilege grants.</li></ul> |
| **P5 Split deploy** | <ul><li>Web on Vercel.</li><li>Gateway on a long-lived container (Fly): migrations as the release command, `/api/ready` probe.</li><li>Managed Postgres with a non-owner role and FORCE RLS.</li><li>Deploy workflow with a smoke test.</li></ul> |
| **P6 Core extraction** | <ul><li>Gateway routes moved into `routes/*` modules.</li><li>Core packages: `@eaos/contracts`, `client`, `utcp`, `audit`, `governance`, `memory`, `skills`, `workflows`, `agents`, `llm`.</li><li>CI enforces that open code never imports commercial code.</li></ul> |
| **P7 MCP products** | <ul><li>`@eaos/mcp-kit`, with middleware: authz → policy → simulate → redact → audit.</li><li>Servers, in order: **Skills → Governance → Memory → Workflows → Regiments**.</li><li>Gateway mount at `/mcp/:product`.</li></ul> |
| **P8 Open-core release** | <ul><li>Apache-2.0 plus NOTICE for open packages.</li><li>npm Trusted Publishing with provenance.</li><li>changesets.</li><li>MCP Registry entries.</li><li>`.mcpb` bundles.</li></ul> |

## Quality gates (every pull request)

- **Static checks:** build, typecheck, lint, unit and contract tests; Postgres acceptance suites (M0, M2).
- **Browser checks:** Playwright E2E of the core loop; `@axe-core/playwright` on every route in light and dark themes.
- **Budgets:** size-limit per route; knip (no unused files).
- **Security:** dependency audit (high and critical block the merge); a secret scan before every push.
