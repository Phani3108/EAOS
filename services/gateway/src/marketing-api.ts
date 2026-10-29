/**
 * Marketing Module API — Workflows, execution, file uploads, approvals
 * Real execution mode with Claude API calls per step.
 * No mock execution — tool connection checks before running.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { MARKETING_WORKFLOW_REFS, getWorkflowRef, type WorkflowRef, type WorkflowStepRef } from './marketing-workflows-data.js';
import { canExecuteWorkflow } from './marketing-tool-connections.js';
import { createCampaignGraph } from './campaign-graph.js';
import { createProject, createTask, updateProject } from './marketing-program.js';
import { callLLM, type LLMProviderId } from './llm-provider.js';
import { getAgentIdentity } from './agent-registry.js';
import { waitForApproval } from './approval-bus.js';
import { createPersonaExecution, getPersonaExecution, listPersonaExecutions } from './persona-api.js';
import { getCompiledDefinition, getCompiledCatalog } from './definition-registry.js';
import { aggregateExecutionStatus, type ExecutionStatus, type RunMode, type StepStatus } from '@agentos/skills/schema';

// In-memory execution store (replace with DB in production)
const executions = new Map<string, MarketingExecutionRecord>();
const fileStore = new Map<string, { name: string; content: string; mimeType: string }>();

export interface MarketingExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: ExecutionStatus;
  tenantId?: string;
  persona?: 'marketing';
  mode?: RunMode;
  steps: Array<{
    stepId: string;
    stepName: string;
    agent: string;
    tool?: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    outputKey?: string;
    outputPreview?: string;
    error?: string;
  }>;
  outputs: Record<string, string>;
  inputs: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  userId?: string;
  projectId?: string;
  campaignGraphId?: string;
}

export type MarketingExecution = MarketingExecutionRecord;

// ---------------------------------------------------------------------------
// Workflow API
// ---------------------------------------------------------------------------

export function getMarketingWorkflows(): WorkflowRef[] {
  return MARKETING_WORKFLOW_REFS;
}

export function getMarketingWorkflow(idOrSlug: string): WorkflowRef | undefined {
  return getWorkflowRef(idOrSlug);
}

export function getMarketingWorkflowsByCluster(): Record<string, WorkflowRef[]> {
  const grouped: Record<string, WorkflowRef[]> = {};
  for (const w of MARKETING_WORKFLOW_REFS) {
    if (!grouped[w.cluster]) grouped[w.cluster] = [];
    grouped[w.cluster].push(w);
  }
  return grouped;
}

export function getMarketingWorkflowClusters(): Record<string, { label: string; icon: string; color: string }> {
  return {
    Campaign: { label: 'Campaign Orchestration', icon: '📡', color: 'blue' },
    Content: { label: 'Content Production', icon: '✍️', color: 'emerald' },
    Creative: { label: 'Creative Studio', icon: '🎨', color: 'pink' },
    Event: { label: 'Event Marketing', icon: '🎪', color: 'orange' },
    Research: { label: 'Research & Intelligence', icon: '🔍', color: 'violet' },
    Analytics: { label: 'Marketing Analytics', icon: '📊', color: 'amber' },
    Sales: { label: 'Sales Enablement', icon: '⚔️', color: 'slate' },
  };
}

// ---------------------------------------------------------------------------
// Pre-check
// ---------------------------------------------------------------------------

const CLUSTER_ICONS: Record<string, string> = {
  Campaign: '📡', Content: '✍️', Creative: '🎨', Event: '🎪',
  Research: '🔍', Analytics: '📊', Sales: '⚔️',
};

/**
 * Return marketing workflows in the generic skill format so the unified
 * ExecutionScreen can render them the same way as Engineering / Product skills.
 */
export function getMarketingSkills() {
  return getCompiledCatalog().filter(definition => definition.persona === 'marketing' && definition.id.startsWith('wf-')).map(definition => ({
    ...definition, category: definition.cluster, inputFields: definition.inputs.map(field => ({ ...field, key: field.id })),
  }));
}

export interface ExecutionPreCheck {
  canExecute: boolean;
  reason?: string;
  missingTools?: string[];
}

export function preCheckExecution(workflowId: string, simulate?: boolean): ExecutionPreCheck {
  const workflow = getWorkflowRef(workflowId);
  if (!workflow) return { canExecute: false, reason: 'Workflow not found' };
  const requiredTools = [...new Set(workflow.steps.map((s) => s.tool).filter(Boolean))] as string[];
  const check = canExecuteWorkflow(requiredTools, simulate);
  return {
    canExecute: check.canExecute,
    reason: check.reason,
    missingTools: check.missingTools,
  };
}

// ---------------------------------------------------------------------------
// Execution Creation
// ---------------------------------------------------------------------------

export async function createMarketingExecution(tenantId: string, workflowId: string, inputs: Record<string, unknown>, userId: string, simulate?: boolean, customPrompt?: string, provider?: LLMProviderId, modelId?: string): Promise<MarketingExecution> {
  const definition = getCompiledDefinition(workflowId, 'marketing');
  if (!definition) throw new Error(`Workflow not found: ${workflowId}`);
  const run = await createPersonaExecution(tenantId, 'marketing', definition, inputs, userId, simulate, customPrompt, provider, modelId);
  return { ...run, persona: 'marketing', workflowId: run.skillId, workflowName: run.skillName };
}

function createLegacyMarketingExecution(
  workflowId: string,
  inputs: Record<string, unknown>,
  userId?: string,
  simulate?: boolean,
  customPrompt?: string,
  provider?: LLMProviderId,
  modelId?: string
): MarketingExecution {
  const workflow = getWorkflowRef(workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const preCheck = preCheckExecution(workflowId, simulate);
  if (!preCheck.canExecute) {
    throw new Error(preCheck.reason ?? 'Execution blocked: required tools not connected');
  }

  const id = `mkt-exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const steps = workflow.steps.map((s) => ({
    stepId: s.id,
    stepName: s.name,
    agent: s.agent,
    tool: s.tool,
    status: 'pending' as const,
    outputKey: s.outputKey,
  }));

  const exec: MarketingExecution = {
    id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    mode: simulate === true ? 'simulation' : 'live',
    status: 'queued',
    steps,
    outputs: {},
    inputs,
    startedAt: new Date().toISOString(),
    userId,
  };

  executions.set(id, exec);

  if (!simulate) {
    const campaignName =
      (inputs.campaign_name as string) ??
      (inputs.webinar_title as string) ??
      (inputs.product_name as string) ??
      workflow.name;
    const project = createProject({
      name: campaignName,
      workflowId: workflow.id,
      pipelineStage: 'idea',
      owner: (userId as string) ?? 'system',
      status: 'active',
    });
    const graph = createCampaignGraph(exec.id, campaignName, workflow.id, project.id, workflow.steps);
    updateProject(project.id, { campaignGraphId: graph.id });
    exec.projectId = project.id;
    exec.campaignGraphId = graph.id;
    let prevTaskId: string | undefined;
    workflow.steps.forEach((step) => {
      const dueAt = new Date();
      dueAt.setHours(dueAt.getHours() + (step.requiresApproval ? 4 : 2));
      const task = createTask({
        projectId: project.id,
        campaignGraphId: graph.id,
        workflowStepId: step.id,
        name: step.name,
        agent: step.agent,
        tool: step.tool,
        status: 'pending',
        owner: (userId as string) ?? 'system',
        dependencies: prevTaskId ? [prevTaskId] : [],
        sla: { dueAt: dueAt.toISOString(), hours: 2 },
        outputKey: step.outputKey,
      });
      prevTaskId = task.id;
    });
  }

  // Fire off real execution asynchronously (non-blocking)
  processExecutionSteps(id, workflow, inputs, simulate, customPrompt, provider, modelId).catch((err) => {
    console.error(`[marketing-api] processExecutionSteps error for ${id}:`, err);
    updateMarketingExecution(id, { status: 'failed' });
  });

  return exec;
}

// ---------------------------------------------------------------------------
// Execution Runtime — Real AI step processing
// ---------------------------------------------------------------------------

/**
 * Call AI model for content generation via multi-LLM provider.
 * Supports Anthropic, OpenAI, Gemini, Azure OpenAI, and Ollama.
 *
 * Throws if no provider is configured or all providers fail — it does not fall
 * back to placeholder content. Simulated output is an explicit choice made by
 * the caller via the `simulate` flag, which routes to
 * `generateMarketingSandboxOutput()` and is labelled as simulated.
 */
async function callAI(systemPrompt: string, userPrompt: string, provider?: LLMProviderId, modelId?: string): Promise<string> {
  const response = await callLLM({
    provider,
    model: modelId,
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  });
  return response.content;
}

// ---------------------------------------------------------------------------
// Marketing Sandbox Output Generator — produces rich, realistic sample content
// ---------------------------------------------------------------------------

function generateMarketingSandboxOutput(
  step: WorkflowStepRef,
  workflowName: string,
  inputs: Record<string, unknown>,
  previousOutputs: Record<string, string>
): string {
  const key = step.outputKey.toLowerCase();
  const inputSummary = Object.entries(inputs)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `- **${k.replace(/_/g, ' ')}**: ${Array.isArray(v) ? v.join(', ') : String(v).slice(0, 120)}`)
    .join('\n');

  if (key.includes('strategy') || key.includes('messaging') || key.includes('brief'))
    return mktSandboxStrategy(step.name, workflowName, inputSummary);
  if (key.includes('email'))
    return mktSandboxEmail(step.name, workflowName, inputSummary);
  if (key.includes('linkedin') || key.includes('social') || key.includes('ad_copy'))
    return mktSandboxSocial(step.name, workflowName, inputSummary);
  if (key.includes('landing') || key.includes('page'))
    return mktSandboxLandingPage(step.name, inputSummary);
  if (key.includes('blog') || key.includes('article') || key.includes('draft'))
    return mktSandboxBlog(step.name, inputSummary);
  if (key.includes('outline') || key.includes('structure'))
    return mktSandboxOutline(step.name, inputSummary);
  if (key.includes('seo') || key.includes('metadata'))
    return mktSandboxSEO(step.name, inputSummary);
  if (key.includes('creative') || key.includes('design'))
    return mktSandboxCreative(step.name, inputSummary);
  if (key.includes('summary') || key.includes('insight') || key.includes('analysis'))
    return mktSandboxAnalysis(step.name, workflowName, inputSummary);
  if (key.includes('subject'))
    return mktSandboxSubjectLines(step.name, inputSummary);
  if (key.includes('newsletter'))
    return mktSandboxNewsletter(step.name, inputSummary);

  // Fallback: generic marketing output
  return mktSandboxGeneric(step.name, workflowName, inputSummary);
}

function mktSandboxStrategy(stepName: string, workflowName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation | **Workflow:** ${workflowName}

## Messaging Strategy

### Core Value Proposition
> "Transform your team's productivity with AI-powered automation that works the way you do — no code changes, no learning curve, just results."

### Target Audience Segments
| Segment | Title | Pain Point | Key Message |
|---------|-------|------------|-------------|
| Primary | VP Engineering | Slow release cycles, manual processes | "Ship 40% faster with automated workflows" |
| Secondary | Director of Product | Disconnected tools, no visibility | "One platform for your entire product lifecycle" |
| Tertiary | CTO | Build vs. buy decisions | "Enterprise-grade AI ops without the infrastructure cost" |

### Messaging Pillars
1. **Speed** — Reduce time-to-value from weeks to hours
2. **Intelligence** — AI that learns from your team's patterns
3. **Control** — Full governance and audit trails for enterprise compliance

### Tone & Voice
- Professional but approachable
- Data-driven claims with specific metrics
- Confident without being pushy

### Key Proof Points
- 3x faster workflow execution vs. manual processes
- 99.9% uptime SLA with SOC 2 compliance
- 200+ enterprise customers in first year

${inputSummary ? `## Campaign Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for AI-tailored strategy based on your specific inputs.*`;
}

function mktSandboxEmail(stepName: string, workflowName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation | **Workflow:** ${workflowName}

## Email Series

### Email 1 — Awareness (Day 0)
**Subject:** Your team is spending 12 hours/week on tasks AI could handle  
**Preview:** See how leading engineering teams are automating their workflows

Hi {{first_name}},

Your engineering team runs on processes — code reviews, incident triage, release coordination. But how much of that is *actually* creative problem-solving vs. repetitive grunt work?

We analyzed 50 engineering orgs and found the average team spends **12 hours per week per person** on coordination tasks that AI can handle.

[See the breakdown →]

Best,  
{{sender_name}}

---

### Email 2 — Interest (Day 3)
**Subject:** How {{company}} could save 480 engineering hours/month  
**Preview:** A personalized estimate based on your team size

Hi {{first_name}},

Based on your team of ~{{team_size}} engineers, here's what automation could unlock:

- **480 hours/month** freed from manual reviews and coordination
- **3.2x faster** incident response with AI triage
- **Zero** context-switching for status updates

[Get your custom analysis →]

---

### Email 3 — Decision (Day 7)
**Subject:** {{peer_company}} reduced their release cycle by 40%  
**Preview:** Customer story + live demo invitation

Hi {{first_name}},

{{peer_company}} faced the same challenges your team has — slow releases, manual QA gates, and engineers burning out on process instead of product.

After implementing AgentOS, they:
- Cut release cycles from 2 weeks to 5 days
- Automated 80% of code review coordination
- Reduced incident MTTR by 65%

**Want to see it in action?** [Book a 15-min demo →]

${inputSummary ? `## Campaign Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for personalized email copy based on your audience and messaging.*`;
}

function mktSandboxSocial(stepName: string, workflowName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation | **Workflow:** ${workflowName}

## LinkedIn Ad Copy Variants

### Variant A — Problem-Agitation
**Headline:** Your engineers are drowning in process, not code  
**Body:**  
Engineering teams spend 30% of their time on coordination — code review assignments, incident triage, release checklists.

What if AI handled all of that?

AgentOS automates the repetitive work so your team focuses on what matters: shipping great software.

✅ Automated code review routing  
✅ AI-powered incident triage  
✅ Smart release coordination

[Start Free Trial →]

---

### Variant B — Social Proof
**Headline:** How 200+ engineering teams ship 40% faster  
**Body:**  
"We went from 2-week release cycles to shipping every 3 days." — VP Eng, Series C SaaS

AgentOS is the AI operating system for engineering teams. Automate workflows, accelerate reviews, and reduce toil.

[See Customer Stories →]

---

### Variant C — Direct Value
**Headline:** Save 12 engineering hours per person per week  
**Body:**  
AgentOS automates code reviews, incident triage, and team coordination with AI agents that learn your codebase.

No integration headaches. No workflow changes. Just results.

[Book Demo →]

### Targeting Recommendations
| Parameter | Value |
|-----------|-------|
| Job Titles | VP Engineering, Director of Engineering, CTO, Engineering Manager |
| Company Size | 200-5000 employees |
| Industries | SaaS, FinTech, HealthTech |
| Budget/Day | $150-300 for A/B testing phase |

${inputSummary ? `## Campaign Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for ad copy tailored to your product and audience.*`;
}

function mktSandboxLandingPage(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Landing Page Copy

### Hero Section
**Headline:** Ship faster. Automate smarter. Build with confidence.  
**Subheadline:** The AI operating system that turns your engineering workflows into automated, intelligent pipelines.  
**CTA:** Start Free Trial →  
**Social proof:** Trusted by 200+ engineering teams worldwide

### Problem Section
**Header:** Your team is stuck in manual mode

> 68% of engineering time goes to non-coding activities. Code reviews pile up. Incidents wake people at 3 AM. Release checklists are still in spreadsheets.

### Solution Section
**Header:** Meet your AI engineering co-pilot

| Feature | Benefit |
|---------|---------|
| 🔍 Smart Code Review | Automated routing, risk scoring, and review suggestions |
| 🚨 Incident Intelligence | AI triage, runbook execution, and auto-escalation |
| 🚀 Release Automation | One-click deployments with safety gates |
| 📊 Team Analytics | Real-time visibility into engineering velocity |

### Social Proof Section
> "AgentOS cut our review turnaround from 2 days to 4 hours." — *Sarah Chen, VP Engineering*

### CTA Section
**Header:** See it in action  
**CTA:** Book a 15-Minute Demo →  
**Sub-CTA:** Or start your free trial — no credit card required

${inputSummary ? `## Campaign Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for landing page copy tuned to your product.*`;
}

function mktSandboxBlog(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Blog Draft

# How AI is Transforming Engineering Team Productivity in 2025

*Reading time: 7 minutes*

## Introduction

Engineering teams are facing an unprecedented productivity paradox. Despite better tools, faster hardware, and more powerful frameworks, developers report spending less time on actual coding than ever before. The culprit? Process overhead.

A recent survey of 500 engineering leaders found that **the average developer spends only 4.2 hours per day writing code**. The rest is consumed by code reviews, incident management, meetings, and coordination.

But a new category of tool is changing this equation: AI-powered engineering operating systems.

## The Problem: Death by a Thousand Process Cuts

Consider a typical week for a senior engineer:
- **Monday:** 2 hours triaging weekend alerts, 1 hour on code reviews
- **Tuesday:** Half-day consumed by release coordination and stakeholder updates
- **Wednesday:** Finally coding, but interrupted 6 times for "quick questions"
- **Thursday:** Sprint planning + retrospective = 3 hours of meetings
- **Friday:** Catch-up on code reviews that piled up all week

Sound familiar?

## The Solution: Intelligent Automation

The key insight is that **most engineering process work follows patterns** — and patterns are exactly what AI excels at recognizing and automating.

### What AI Can Automate Today
1. **Code review triage** — Route PRs to the right reviewers based on expertise and availability
2. **Incident response** — Auto-classify severity, suggest runbooks, and draft status updates
3. **Release coordination** — Automate checklists, approvals, and deployment gates

## Conclusion

The engineering teams that thrive in 2025 won't be the ones with the most developers — they'll be the ones who multiply each developer's impact through intelligent automation.

*[CTA: See how AgentOS automates engineering workflows →]*

${inputSummary ? `## Content Brief\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for blog content based on your topic and audience.*`;
}

function mktSandboxOutline(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Content Outline

### Structure
1. **Introduction** (150 words)
   - Hook with surprising statistic
   - Frame the problem
   - Thesis statement

2. **The Challenge** (300 words)
   - Current state pain points
   - Cost of inaction (quantified)
   - Why traditional solutions fall short

3. **The Approach** (400 words)
   - New paradigm introduction
   - 3 key capability pillars
   - How it differs from existing solutions

4. **Real-World Impact** (300 words)
   - Customer example with metrics
   - Before/after comparison
   - ROI calculation

5. **Getting Started** (200 words)
   - Quick-start path
   - Common first use case
   - CTA

### SEO Keywords
Primary: AI engineering automation, developer productivity  
Secondary: code review automation, incident management AI  
Long-tail: how to automate engineering workflows with AI

### Content Notes
- Target 1,500 words total
- Include 2-3 data visualizations
- Link to related case study and product page

${inputSummary ? `## Brief\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for an outline tailored to your topic.*`;
}

function mktSandboxSEO(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## SEO Metadata

### Page Meta
| Field | Value |
|-------|-------|
| **Title Tag** | AI Engineering Automation: Ship 40% Faster \\| AgentOS |
| **Meta Description** | Discover how AI-powered automation helps engineering teams ship faster, reduce toil, and improve code quality. Free trial available. |
| **Canonical URL** | /blog/ai-engineering-automation-guide |
| **OG Title** | How AI is Transforming Engineering Productivity |
| **OG Description** | Engineering teams spend 30% of time on process. Here's how to reclaim it. |
| **OG Image Alt** | Dashboard showing engineering velocity metrics |

### Keywords
| Keyword | Volume | Difficulty | Intent |
|---------|--------|------------|--------|
| AI engineering automation | 2,400/mo | Medium | Informational |
| developer productivity tools | 5,100/mo | High | Commercial |
| code review automation | 1,800/mo | Low | Commercial |
| engineering workflow AI | 880/mo | Low | Informational |

### Internal Links
- /product/features → "See all features"
- /customers/case-studies → "Customer stories"
- /docs/getting-started → "Quick start guide"

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for SEO analysis based on your actual content.*`;
}

function mktSandboxCreative(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Creative Brief

### Concept A — "Before/After"
**Visual:** Split-screen showing chaotic Slack/email notifications vs. clean AgentOS dashboard  
**Copy overlay:** "From chaos to clarity in one click"  
**Format:** 1200x628 (LinkedIn feed), 1080x1080 (Instagram)  
**Color palette:** Navy blue → Teal gradient, white text

### Concept B — "Time Saved"
**Visual:** Clock face with 12 hours highlighted, shrinking to 2 hours  
**Copy overlay:** "12 hours of process → 2 hours with AI"  
**Animation:** Counter counting down from 12 to 2  
**Format:** 15-second video, MP4

### Concept C — "Team Focus"
**Visual:** Developer at desk, smiling, with AI assistant handling floating task cards  
**Copy overlay:** "Let AI handle the busywork"  
**Style:** Illustrated, friendly, modern SaaS aesthetic  
**Format:** Static banner, 728x90 + 300x250

### Design System Notes
- Font: Inter (headlines), System UI (body)
- Primary: #0F172A (dark navy)
- Accent: #06B6D4 (cyan)
- CTA buttons: #6366F1 (indigo) with white text

${inputSummary ? `## Creative Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for AI-generated creative concepts.*`;
}

function mktSandboxAnalysis(stepName: string, workflowName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation | **Workflow:** ${workflowName}

## Analysis

### Key Insights
1. **Market timing is favorable** — 73% of engineering leaders are actively evaluating AI tools (Gartner 2025)
2. **Competitive gap exists** — No dominant player in AI-powered engineering operations (unlike DevSecOps which is crowded)
3. **Budget allocated** — 61% of organizations have dedicated budget for AI developer tools this year

### Metrics Overview
| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Website traffic | 15K/mo | 25K/mo | +67% |
| MQL generation | 120/mo | 200/mo | +67% |
| Content pipeline | 4 pieces/mo | 8 pieces/mo | +100% |
| Email open rate | 22% | 30% | +36% |

### Recommendations
1. Double down on bottom-of-funnel content (case studies, ROI calculators)
2. Launch LinkedIn thought leadership series from engineering leaders
3. A/B test problem-agitation vs. social-proof ad messaging

${inputSummary ? `## Analysis Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for analysis based on your actual data.*`;
}

function mktSandboxSubjectLines(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Subject Line Variants

### A/B Test Group 1 — Curiosity
| Variant | Subject Line | Predicted Open Rate |
|---------|-------------|-------------------|
| A1 | Your engineers are spending 12 hours/week on this | 28% |
| A2 | The automation gap most teams don't know they have | 25% |
| A3 | What if your team shipped twice as fast? | 24% |

### A/B Test Group 2 — Social Proof
| Variant | Subject Line | Predicted Open Rate |
|---------|-------------|-------------------|
| B1 | How {{peer_company}} cut their release cycle by 40% | 31% |
| B2 | 200 engineering teams can't be wrong | 22% |
| B3 | "We went from 2 weeks to 3 days" — VP Eng | 29% |

### A/B Test Group 3 — Direct Value
| Variant | Subject Line | Predicted Open Rate |
|---------|-------------|-------------------|
| C1 | Save 480 engineering hours this month | 26% |
| C2 | Automate code reviews, incidents, and releases | 21% |
| C3 | Your free AI engineering co-pilot is ready | 27% |

### Recommendation
Start with **B1** and **A1** as the primary A/B test. Both leverage specificity and curiosity, which historically perform best in B2B tech email.

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for subject lines tailored to your campaign.*`;
}

function mktSandboxNewsletter(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Newsletter Draft

### 📬 The AgentOS Weekly — Issue #42

---

**This week:** AI engineering trends, a new integration, and a customer spotlight.

---

### 🔥 Top Story: The State of AI in Engineering Ops

A new report from Forrester shows 78% of engineering leaders plan to adopt AI-powered workflow automation by 2026. Here's what that means for your team.

[Read the full analysis →]

---

### 🚀 Product Update: Slack Integration v2.0

We shipped a major update to our Slack connector:
- **Thread-aware incident triage** — AgentOS now reads full Slack threads for context
- **One-click approvals** — Approve workflow steps directly from Slack
- **Custom alert routing** — Route by severity, team, or service

[See what's new →]

---

### 🏆 Customer Spotlight: How Acme Corp Reduced MTTR by 65%

Acme Corp's engineering team was drowning in alerts. With AgentOS incident intelligence, they automated triage and cut mean-time-to-resolution from 4 hours to 84 minutes.

[Read the case study →]

---

### 📊 Engineering Pulse
- **PRs reviewed this week across all users:** 12,847
- **Average review time:** 2.3 hours (down from 8.1 hours)
- **Incidents auto-triaged:** 3,291

---

*You're receiving this because you signed up for AgentOS updates. [Unsubscribe]*

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for newsletter content from your actual data.*`;
}

function mktSandboxGeneric(stepName: string, workflowName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation | **Workflow:** ${workflowName}

## Output

### Key Deliverables
1. **Primary asset created** with structured sections, clear messaging, and actionable content
2. **Supporting materials** generated for cross-channel distribution
3. **Performance targets** defined with measurable KPIs

### Content Summary
This step produced marketing content aligned with the campaign strategy and brand guidelines. The output includes:

- Audience-targeted messaging across 3 segments
- Channel-specific copy variants (email, social, web)
- Performance benchmarks and success metrics
- Recommended distribution timeline

### Quality Checklist
- [x] Brand voice and tone consistency
- [x] Clear call-to-action in every piece
- [x] Metrics-driven claims with supporting data
- [x] Cross-channel message alignment
- [ ] Legal/compliance review (pending)

${inputSummary ? `## Campaign Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for content tailored to your specific campaign.*`;
}

/**
 * Build a rich prompt for a workflow step using user inputs and previous outputs.
 */
function buildStepPrompt(
  step: WorkflowStepRef,
  workflowName: string,
  inputs: Record<string, unknown>,
  previousOutputs: Record<string, string>,
  customPrompt?: string
): { system: string; user: string } {
  // Format input fields as readable context
  const inputLines = Object.entries(inputs)
    .filter(([k, v]) => k !== '_fileIds' && v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => {
      const label = k.replace(/_/g, ' ');
      const val = Array.isArray(v) ? v.join(', ') : String(v);
      return `**${label}**: ${val}`;
    })
    .join('\n');

  // Include previous step outputs as context (truncated for token limit)
  const prevContext =
    Object.keys(previousOutputs).length > 0
      ? '\n\n## Context from Previous Steps\n\n' +
        Object.entries(previousOutputs)
          .map(([k, v]) => `### ${k.replace(/_/g, ' ')}\n${v.slice(0, 800)}${v.length > 800 ? '\n...[truncated]' : ''}`)
          .join('\n\n')
      : '';

  const system = `You are an expert marketing strategist and copywriter working inside AgentOS, an AI operating system for enterprise marketing teams.

You are executing the "${workflowName}" workflow. Produce high-quality, specific, immediately usable marketing content.

Guidelines:
- Be concrete and specific — no generic filler
- Format output with clear sections, headers, and bullet points
- Write in a professional B2B tone unless brand notes indicate otherwise
- Include specific calls-to-action, metrics targets, and timelines where relevant
- Output should be ready to review and use with minimal editing`;

  const customSection = customPrompt
    ? `\n\n## Additional Instructions (from selected prompt)\n${customPrompt}`
    : '';

  const user = `## Workflow Step: ${step.name}

## User Inputs
${inputLines || 'No structured inputs provided.'}${prevContext}${customSection}

## Your Task
Execute the "${step.name}" step. Produce comprehensive, high-quality output that is immediately actionable. Include specific details, copy, and recommendations based on the inputs above.`;

  return { system, user };
}

/**
 * Process all steps of an execution asynchronously.
 * Updates each step's status and stores outputs in real time.
 */
async function processExecutionSteps(
  execId: string,
  workflow: WorkflowRef,
  inputs: Record<string, unknown>,
  simulate?: boolean,
  customPrompt?: string,
  provider?: LLMProviderId,
  modelId?: string
): Promise<void> {
  // Brief delay to let the HTTP response return first
  await new Promise((r) => setTimeout(r, 300));

  const exec = executions.get(execId);
  if (!exec) return;

  updateMarketingExecution(execId, { status: 'running' });

  const stepOutputs: Record<string, string> = {};

  for (const step of workflow.steps) {
    // Get fresh execution record before each step
    const currentExec = executions.get(execId);
    if (!currentExec || currentExec.status === 'failed') break;

    // Mark step as running
    updateMarketingExecutionStep(execId, step.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    try {
      let output: string;

      if (simulate) {
        // Simulation mode: generate rich, structured sandbox content
        await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
        output = generateMarketingSandboxOutput(step, workflow.name, inputs, stepOutputs);
      } else {
        if (step.tool && step.tool !== 'Claude' && step.tool !== 'llm') throw new Error('Legacy tool step has no validated live adapter');
        // Build prompt from step context and user inputs
        const { system, user } = buildStepPrompt(step, workflow.name, inputs, stepOutputs, customPrompt);
        // Inject agent identity into system prompt if available
        const agentIdentity = getAgentIdentity(step.agent);
        const enrichedSystem = agentIdentity
          ? `${agentIdentity.systemPrompt}\n\n---\n\n${system}`
          : system;
        output = await callAI(enrichedSystem, user, provider, modelId);
      }

      // Store output
      const outputKey = step.outputKey ?? step.id;
      stepOutputs[outputKey] = output;

      // Persist outputs to execution record after each step
      const freshExec = executions.get(execId);
      if (freshExec) {
        const merged = { ...freshExec.outputs, [outputKey]: output };
        executions.set(execId, { ...freshExec, outputs: merged });
      }

      if (step.requiresApproval && !simulate) {
        // Block the workflow here until a user explicitly approves or rejects
        // via POST /api/executions/:id/approve/:stepId. Emits 'approval.requested'
        // on the event bus so Slack / email notifiers can surface the wait.
        updateMarketingExecutionStep(execId, step.id, {
          status: 'approval_required',
          outputPreview: output.slice(0, 300),
          outputKey,
        });
        updateMarketingExecution(execId, { status: 'paused' });

        const decision = await waitForApproval(execId, step.id, {
          stepName: step.name,
        });

        if (!decision.approved) {
          updateMarketingExecutionStep(execId, step.id, {
            status: 'failed',
            error: decision.reason ?? 'Rejected by approver',
            completedAt: new Date().toISOString(),
          });
          updateMarketingExecution(execId, { status: 'failed', completedAt: new Date().toISOString() });
          return;
        }

        updateMarketingExecutionStep(execId, step.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
        updateMarketingExecution(execId, { status: 'running' });
      } else {
        updateMarketingExecutionStep(execId, step.id, {
          status: simulate ? 'simulated' : 'completed',
          completedAt: new Date().toISOString(),
          outputPreview: output.slice(0, 300),
          outputKey,
        });
      }

      // Small delay between steps for UX visibility
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Step execution failed';
      updateMarketingExecutionStep(execId, step.id, {
        status: 'failed',
        error: message,
        completedAt: new Date().toISOString(),
      });
      // A failed dependency must stop downstream work
      break;
    }
  }

  // Mark overall execution as completed
  const finalExec = executions.get(execId);
  const allSteps = finalExec?.steps ?? [];
  const anyFailed = allSteps.some((s) => s.status === 'failed');
  const allDone = allSteps.every((s) => ['completed', 'failed', 'approval_required'].includes(s.status));

  updateMarketingExecution(execId, {
    status: aggregateExecutionStatus(allSteps.map(step => step.status as StepStatus), simulate ? 'simulation' : 'live'),
    completedAt: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Execution CRUD
// ---------------------------------------------------------------------------

export function getMarketingExecution(id: string): MarketingExecution | undefined {
  const run = getPersonaExecution(id);
  return run?.persona === 'marketing' ? { ...run, persona: 'marketing', workflowId: run.skillId, workflowName: run.skillName } : executions.get(id);
}

export function updateMarketingExecution(id: string, updates: Partial<MarketingExecution>): MarketingExecution | undefined {
  const exec = executions.get(id);
  if (!exec) return undefined;
  const updated = { ...exec, ...updates };
  executions.set(id, updated);
  return updated;
}

export function updateMarketingExecutionStep(
  execId: string,
  stepId: string,
  updates: Partial<MarketingExecution['steps'][0]>
): MarketingExecution | undefined {
  const exec = executions.get(execId);
  if (!exec) return undefined;
  const steps = exec.steps.map((s) => (s.stepId === stepId ? { ...s, ...updates } : s));
  const updated = { ...exec, steps };
  executions.set(execId, updated);
  return updated;
}

export function getRecentMarketingExecutions(limit = 20): MarketingExecution[] {
  return [...Array.from(executions.values()), ...listPersonaExecutions('marketing', limit).map(run => ({ ...run, persona: 'marketing' as const, workflowId: run.skillId, workflowName: run.skillName }))]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// File Store
// ---------------------------------------------------------------------------

export function storeUploadedFile(fileId: string, name: string, content: string, mimeType: string): void {
  fileStore.set(fileId, { name, content, mimeType });
}

export function getUploadedFile(fileId: string): { name: string; content: string; mimeType: string } | undefined {
  return fileStore.get(fileId);
}

export function recordMarketingAnalytics(exec: MarketingExecution): void {
  // Feed into core AgentOS analytics — stub for integration
  void exec;
}
