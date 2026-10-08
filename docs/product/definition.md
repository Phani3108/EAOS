# EAOS: product definition

> **EAOS lets business teams delegate work to accountable AI agent regiments: every step attributed, every external action approved, every outcome audited.**

Delegate a goal or run a skill, and a regiment of named, ranked agents plans and does the work. Anything that touches the outside world stops at *your* approval gate, which shows the draft, the evidence and the cost. Every step shows the agent's call sign, whether it ran live or simulated, and its tokens and cost. All of it lands in an audit log you can verify.

## Who it is for

**Ideal customer:** organisations of 500–50,000 people that work in Slack, Jira and GitHub and have an AI-governance gate. The buyer is the functional VP, the champion is that function's ops lead, and IT or security signs off. Developers who want to embed EAOS capabilities use the open MCP products (see [roadmap](../roadmap.md)).

| Role | Who | Platform role | Primary surfaces |
|---|---|---|---|
| Requester | Business team member | `user` | Home, Runs, Library, Regiments, Insights (team view) |
| Approver | Team lead or manager | `approver` (scoped to regiments) | + Approvals |
| Builder | Ops lead or platform engineer | `operator` | + Automations, Governance (usage, operations) |
| Admin | IT or security | `admin` | Everything, including members, connections, audit and policies |

## Jobs to be done

1. Hand off repeatable work and get a draft I can review within minutes.
2. Decide on external actions in one place, with the evidence in front of me.
3. Answer "who did this, why, and at what cost?" for any outcome.
4. Make recurring work run on its own without losing control of it.
5. Show leadership the throughput, quality and spend of each team.

## North star and guardrails

**North star: accepted live outcomes per week.** These are completed runs that ran live with no rejected gate, counted per regiment.

| Guardrail | Definition | Target |
|---|---|---|
| Approval latency | Median time from gate requested to gate decided; share of gates that expire undecided | Median under 4h; under 5% expire |
| Rejection rate | Rejected gates ÷ decided gates, per skill | Under 15% |
| Cost per outcome | Total step cost ÷ accepted outcomes | Within budget; no runs blocked by budget |
| Time to first outcome | From sign-in to first completed run | Under 3 minutes in the demo; under 1 day live |

All of these are computed on the server from runs, steps and approvals, never estimated in the browser.

## Principles

1. **One loop, one home.** Every screen answers "what's mine to do next?"
2. **Truth over theatre.** Show only what the server returned. A 401 means sign in, never demo data. Empty means empty.
3. **Simulation is a visible mode.** Use a persistent banner and badge, the way Stripe shows test mode. Never hide it.
4. **Name plus role, always.** For example, "Hyperion · Chief Marketing Officer agent".
5. **Rank never outranks a human.** External or irreversible actions always need a person.
6. **Show the receipt.** From any outcome, one click reaches the draft, evidence, cost, mode and audit trail.
7. **Progressive depth.** The business view comes first; traces and token counts are one click deeper.
8. **Copy proven patterns.**
   - Linear: inbox, keyboard and saved views.
   - Stripe: receipts and test mode.
   - Vercel: deployments list.
   - GitHub Actions: run timeline and graph.

## Glossary: one concept, one name

| Term | Meaning |
|---|---|
| **EAOS** | The product |
| **Workspace** | The organisation (the tenant) |
| **Regiment** | The agent team for a business function, such as Olympian (Marketing), Asgard (Engineering), Explorer (Product), Eden (People) or Titan (Executive & Programs) |
| **Call sign** | An agent's stable identity, such as Hermes or Zeus. It appears in timelines, gates and the audit log |
| **Rank** | An agent's autonomy tier: Corporal, Captain, Colonel, Field marshal or General |
| **Skill** | Anything runnable from the Library. Kinds: Task, Workflow, Flagship |
| **Run** | One execution of a skill. Modes: Skill, Goal, Meeting, Swarm |
| **Step / Gate** | One agent's unit of work / a human approval point |
| **Draft / Outcome / Artifact** | Proposed output / accepted result / file |
| **Live / Simulated** | Real model and connectors / illustrative only, always labelled |
| **Automation** | A schedule or trigger that starts runs |
| **Connection** | A verified external system. EAOS stores a secret reference, never the token |
| **Insights / Governance / Labs** | Analytics / administration / experiments |

## The brand is functional

The regiments, ranks and call signs are the product's identity, and they carry real meaning:

- **Rank sets autonomy.**

  | Rank | Ceiling |
  |---|---|
  | Corporal | Draft only |
  | Captain | + read knowledge and connected tools |
  | Colonel and up | + reversible internal writes, where regiment policy allows |

  - Risk classes: R0 draft, R1 read, R2 reversible internal write, R3 external or irreversible.
  - **R3 always needs a human.**
  - Rank can only add gates, never remove them.
- **Regiment = scope.** The regiment switcher scopes Home, Runs, Approvals, Library and Insights. Approvers are assigned per regiment.
- **Call sign = accountability.** Every agent action in a timeline, gate, artifact or audit row names the agent that took it.
- **Chain of command = escalation.**
  - A failed or inconclusive step escalates to the supervising agent.
  - A pending gate first reminds its approver, then notifies the rest of the regiment, then operators, and finally expires with "Re-request".
- **Officer numbers are derived, never hardcoded.** Headcount and 30-day stats come from the registry and from runs.
