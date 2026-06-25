/**
 * Persona API — Shared execution runtime for all personas (Engineering, Product, HR, Marketing)
 * Uses the multi-LLM provider system and agent identity injection.
 * Every step is executed with the assigned agent's system prompt, quality gates,
 * and handoff validation between steps.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { PersonaSkillDef, SkillStep } from './engineering-skills-data.js';
import { callLLM as callLLMProvider, type LLMProviderId, type LLMResponse } from './llm-provider.js';
import { tracedLLMCall } from './llm-tracer.js';
import { containsPII, redact as redactPII } from './pii-redactor.js';
import { routedLLMCall, recordCostEntry, detectComplexity } from './model-router.js';
import { createUTCPPacket, storePacket, getPacket, updatePacketStatus } from './utcp-protocol.js';
import { createA2AMessage, storeMessage } from './a2a-protocol.js';
import { createMCPAction, executeMCPAction } from './mcp-executor.js';
import { memoryGraph } from './memory-graph.js';
import { eventBus } from './event-bus.js';
import { enqueue as taskEnqueue, type PersonaId as QueuePersonaId } from './task-queue.js';
import { getAgentIdentity, getAgentsByPersona, validateHandoff, type AgentIdentity } from './agent-registry.js';
import { buildAgentMemoryContext, extractAndStoreMemory, initAgentMemory } from './agent-memory.js';
import { waitForApproval } from './approval-bus.js';
import type { Store } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonaExecutionRecord {
  id: string;
  persona: 'engineering' | 'product' | 'hr' | 'marketing';
  skillId: string;
  skillName: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  /** Sequential (default) or DAG-based execution */
  executionMode?: 'sequential' | 'dag';
  provider?: LLMProviderId;
  model?: string;
  steps: Array<{
    stepId: string;
    stepName: string;
    agent: string;
    agentCallSign?: string;
    agentRank?: string;
    tool?: string;
    status: string;
    startedAt?: string;
    completedAt?: string;
    outputKey?: string;
    outputPreview?: string;
    error?: string;
    /** DAG: step IDs this step depends on */
    dependsOn?: string[];
    // KPI tracking
    latencyMs?: number;
    tokenCost?: number;
    qualityScore?: number;
    handoffValid?: boolean;
    handoffWarnings?: string[];
  }>;
  /** DAG edges (when executionMode === 'dag') */
  edges?: Array<{ from: string; to: string; condition?: string }>;
  outputs: Record<string, string>;
  inputs: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  userId?: string;
  // Aggregate metrics
  totalTokenCost?: number;
  totalLatencyMs?: number;
  avgQualityScore?: number;
  /** UTCP task ID linking this execution to the protocol layer */
  utcpTaskId?: string;
}

// ---------------------------------------------------------------------------
// In-memory execution store (with optional persistence backing)
// ---------------------------------------------------------------------------

const executions = new Map<string, PersonaExecutionRecord>();
const afterActionReports = new Map<string, AfterActionReport>();
const retrainingFlags = new Map<string, RetrainingFlag>();
let backingStore: Store | null = null;
const EXEC_TABLE = 'persona_executions';
const KPI_TABLE = 'agent_kpis';
const AAR_TABLE = 'after_action_reports';
const RETRAIN_TABLE = 'retraining_flags';

// ---------------------------------------------------------------------------
// After-Action Report type
// ---------------------------------------------------------------------------

export interface AfterActionReport {
  id: string;
  executionId: string;
  persona: string;
  skillName: string;
  generatedAt: string;
  /** Overall execution status */
  outcome: 'success' | 'partial' | 'failure';
  /** How long the entire execution took */
  totalDurationMs: number;
  /** Total token cost across all steps */
  totalTokenCost: number;
  /** Summary paragraph */
  summary: string;
  /** Per-agent breakdown */
  agentPerformance: Array<{
    agentId: string;
    callSign: string;
    rank: string;
    stepName: string;
    status: string;
    durationMs: number;
    qualityScore: number;
    tokenCost: number;
    handoffValid: boolean;
    handoffWarnings: string[];
    /** Whether the agent was swapped via adaptive routing */
    wasRouted: boolean;
  }>;
  /** Handoff chain analysis */
  handoffChain: Array<{
    from: string;
    to: string;
    valid: boolean;
    missingFields: string[];
  }>;
  /** Flagged issues */
  issues: string[];
  /** Recommendations for improvement */
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Retraining Flag type
// ---------------------------------------------------------------------------

export interface RetrainingFlag {
  agentId: string;
  callSign: string;
  persona: string;
  flaggedAt: string;
  reason: 'low_quality' | 'handoff_failures' | 'high_latency' | 'high_cost';
  severity: 'warning' | 'critical';
  /** Current metric value */
  currentValue: number;
  /** Threshold that was breached */
  threshold: number;
  /** Number of consecutive executions below threshold */
  consecutiveFailures: number;
  /** Suggested action */
  suggestedAction: string;
  /** Whether a human has acknowledged this flag */
  acknowledged: boolean;
}

/** Initialize persistence — call from server.ts with the gateway store */
export function initPersonaStore(store: Store): void {
  backingStore = store;
  // Restore executions from persistent store
  const saved = store.all(EXEC_TABLE);
  for (const row of saved) {
    const rec = row as unknown as PersonaExecutionRecord;
    if (rec.id) executions.set(rec.id, rec);
  }
  // Restore KPIs from persistent store
  const savedKPIs = store.all(KPI_TABLE);
  for (const row of savedKPIs) {
    const kpi = row as unknown as AgentKPI;
    if (kpi.agentId) agentKPIs.set(kpi.agentId, kpi);
  }
  // Restore after-action reports
  const savedAARs = store.all(AAR_TABLE);
  for (const row of savedAARs) {
    const aar = row as unknown as AfterActionReport;
    if (aar.id) afterActionReports.set(aar.id, aar);
  }
  // Restore retraining flags
  const savedFlags = store.all(RETRAIN_TABLE);
  for (const row of savedFlags) {
    const flag = row as unknown as RetrainingFlag;
    if (flag.agentId) retrainingFlags.set(flag.agentId, flag);
  }

  const execCount = executions.size;
  const kpiCount = agentKPIs.size;
  if (execCount > 0 || kpiCount > 0) {
    console.log(`[persona-api] Restored ${execCount} executions, ${kpiCount} agent KPIs, ${afterActionReports.size} AARs, ${retrainingFlags.size} retraining flags`);
  }

  // Wire agent memory persistence
  initAgentMemory(store);
}

/** Persist an execution record to backing store */
function persistExec(exec: PersonaExecutionRecord): void {
  executions.set(exec.id, exec);
  if (backingStore) {
    const existing = backingStore.get(EXEC_TABLE, exec.id);
    if (existing) {
      backingStore.update(EXEC_TABLE, exec.id, exec as unknown as Record<string, unknown>);
    } else {
      backingStore.insert(EXEC_TABLE, exec.id, exec as unknown as Record<string, unknown>);
    }
  }
}

/** Persist a KPI record to backing store */
function persistKPI(agentId: string, kpi: AgentKPI): void {
  agentKPIs.set(agentId, kpi);
  if (backingStore) {
    const existing = backingStore.get(KPI_TABLE, agentId);
    if (existing) {
      backingStore.update(KPI_TABLE, agentId, kpi as unknown as Record<string, unknown>);
    } else {
      backingStore.insert(KPI_TABLE, agentId, kpi as unknown as Record<string, unknown>);
    }
  }
}

/** Persist an after-action report */
function persistAAR(aar: AfterActionReport): void {
  afterActionReports.set(aar.id, aar);
  if (backingStore) {
    const existing = backingStore.get(AAR_TABLE, aar.id);
    if (existing) {
      backingStore.update(AAR_TABLE, aar.id, aar as unknown as Record<string, unknown>);
    } else {
      backingStore.insert(AAR_TABLE, aar.id, aar as unknown as Record<string, unknown>);
    }
  }
}

/** Persist a retraining flag */
function persistRetrainingFlag(flag: RetrainingFlag): void {
  retrainingFlags.set(flag.agentId, flag);
  if (backingStore) {
    const existing = backingStore.get(RETRAIN_TABLE, flag.agentId);
    if (existing) {
      backingStore.update(RETRAIN_TABLE, flag.agentId, flag as unknown as Record<string, unknown>);
    } else {
      backingStore.insert(RETRAIN_TABLE, flag.agentId, flag as unknown as Record<string, unknown>);
    }
  }
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

/** Unified LLM call — routes to the configured provider (Claude, OpenAI, Gemini, Ollama, Azure) */
async function callLLMUnified(
  systemPrompt: string,
  userPrompt: string,
  provider?: LLMProviderId,
  modelId?: string,
  persona?: string,
  skillComplexity?: string
): Promise<LLMResponse> {
  // Use model router for intelligent routing when no specific model requested
  if (!modelId) {
    const result = await routedLLMCall(systemPrompt, userPrompt, {
      preferredProvider: provider,
      maxCostPerExec: 1.0,
      maxCostPerHour: parseFloat(process.env.COST_BUDGET_HOURLY_USD ?? '50'),
      cheapRetries: true,
    }, skillComplexity);

    // Record cost for metering
    recordCostEntry(result.provider, result.model, persona ?? 'unknown', result.cost, result.inputTokens, result.outputTokens);

    return result;
  }

  // Direct provider call when model is explicitly specified
  const response = await tracedLLMCall({
    provider,
    model: modelId,
    systemPrompt,
    userPrompt,
    maxTokens: 4096,
  }, `llm.call.${persona ?? 'unknown'}`);

  recordCostEntry(response.provider, response.model, persona ?? 'unknown', response.cost, response.inputTokens, response.outputTokens);

  return response;
}

// ---------------------------------------------------------------------------
// Sandbox Output Generator — produces structured, realistic sample content
// ---------------------------------------------------------------------------

function generateSandboxOutput(
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  skillName: string,
  step: SkillStep,
  inputs: Record<string, unknown>,
  previousOutputs: Record<string, string>
): string {
  const key = step.outputKey.toLowerCase();
  const name = step.name;
  const inputSummary = Object.entries(inputs)
    .filter(([, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => `- **${k.replace(/_/g, ' ')}**: ${Array.isArray(v) ? v.join(', ') : String(v).slice(0, 120)}`)
    .join('\n');

  // Pick a generator based on the output key / step name patterns
  if (key.includes('review') || key.includes('correctness'))
    return sandboxReview(name, inputSummary);
  if (key.includes('security'))
    return sandboxSecurity(name, inputSummary);
  if (key.includes('performance'))
    return sandboxPerformance(name, inputSummary);
  if (key.includes('test') || key.includes('unit_test') || key.includes('integration'))
    return sandboxTests(name, inputSummary, inputs);
  if (key.includes('summary') || key.includes('checklist'))
    return sandboxSummary(name, skillName, inputSummary);
  if (key.includes('analysis') || key.includes('logic') || key.includes('detection'))
    return sandboxAnalysis(name, inputSummary);
  if (key.includes('diff') || key.includes('metadata') || key.includes('context') || key.includes('source'))
    return sandboxMetadata(name, inputSummary);
  if (key.includes('suggestion') || key.includes('inline') || key.includes('patch'))
    return sandboxSuggestions(name, inputSummary);
  if (key.includes('architecture') || key.includes('design') || key.includes('diagram'))
    return sandboxArchitecture(name, inputSummary);
  if (key.includes('roadmap') || key.includes('plan') || key.includes('timeline'))
    return sandboxPlan(name, inputSummary);
  if (key.includes('doc') || key.includes('readme') || key.includes('guide'))
    return sandboxDocumentation(name, inputSummary);
  if (key.includes('requirement') || key.includes('spec') || key.includes('story') || key.includes('prd'))
    return sandboxRequirements(name, inputSummary);
  if (key.includes('deploy') || key.includes('ci') || key.includes('pipeline'))
    return sandboxPipeline(name, inputSummary);

  // Fallback: generic structured output
  return sandboxGeneric(name, skillName, persona, inputSummary);
}

function sandboxReview(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Code Review Findings

### Critical Issues (2)
| # | File | Line | Finding | Severity |
|---|------|------|---------|----------|
| 1 | \`src/api/handler.ts\` | 42 | Missing input validation on user-supplied \`id\` parameter — potential injection vector | 🔴 Critical |
| 2 | \`src/db/queries.ts\` | 118 | Unbounded query without \`LIMIT\` — could return entire table on edge cases | 🟠 High |

### Warnings (3)
- **Dead code**: \`calculateLegacyDiscount()\` in \`pricing.ts:67\` is never called
- **Inconsistent error handling**: Some controllers return \`{ error }\`, others throw — standardize pattern
- **Missing null check**: \`user.profile.avatar\` accessed without optional chaining at \`profile.ts:23\`

### Positive Observations
- Clean separation of concerns between service and controller layers
- Good use of TypeScript discriminated unions for API responses
- Test coverage for happy paths is solid

${inputSummary ? `## Review Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run in Live mode with API key for AI-generated analysis of your actual code.*`;
}

function sandboxSecurity(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Security Scan Results

### Vulnerabilities Found
| Severity | Category | Location | Description |
|----------|----------|----------|-------------|
| 🔴 Critical | SQL Injection | \`db/queries.ts:45\` | String concatenation in query builder — use parameterized queries |
| 🟠 High | XSS | \`components/Comment.tsx:12\` | \`dangerouslySetInnerHTML\` with unsanitized user content |
| 🟡 Medium | Secrets | \`.env.example\` | Contains placeholder that resembles actual API key format |
| 🟢 Low | CORS | \`server.ts:8\` | Wildcard CORS origin in non-development config |

### Recommendations
1. Replace string concatenation with parameterized queries or ORM methods
2. Sanitize HTML content through DOMPurify before rendering
3. Rotate any credentials matching the exposed pattern
4. Restrict CORS to specific allowed origins in production config

${inputSummary ? `## Scan Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — connect security tools and run Live for real vulnerability scanning.*`;
}

function sandboxPerformance(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Performance Analysis

### Hot Spots Identified
| Area | Impact | Issue | Recommendation |
|------|--------|-------|----------------|
| Database | High | N+1 query in user list endpoint | Use \`JOIN\` or batch loader pattern |
| Rendering | Medium | Large list without virtualization (2000+ items) | Implement windowing with \`react-window\` |
| Bundle | Medium | Importing entire \`lodash\` (72KB gzipped) | Switch to \`lodash-es\` with tree-shaking |
| API | Low | No response caching for static catalog data | Add \`Cache-Control\` headers, consider Redis |

### Metrics Estimate
- **Current P95 latency**: ~420ms (list endpoint)
- **After fixes**: ~85ms (projected)
- **Bundle reduction**: ~45KB gzipped savings

${inputSummary ? `## Analysis Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for AI-powered analysis of your actual codebase.*`;
}

function sandboxTests(stepName: string, inputSummary: string, inputs: Record<string, unknown>): string {
  const lang = (inputs.language as string) || 'TypeScript';
  const framework = (inputs.test_framework as string) || 'Jest';
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Generated Tests — ${lang} / ${framework}

\`\`\`typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UserService } from '../src/services/user-service';
import { mockDb } from './helpers/mock-db';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    service = new UserService(mockDb());
  });

  describe('createUser', () => {
    it('should create a user with valid input', async () => {
      const result = await service.createUser({
        email: 'test@example.com',
        name: 'Test User',
      });
      expect(result.id).toBeDefined();
      expect(result.email).toBe('test@example.com');
    });

    it('should reject duplicate email addresses', async () => {
      await service.createUser({ email: 'dup@example.com', name: 'First' });
      await expect(
        service.createUser({ email: 'dup@example.com', name: 'Second' })
      ).rejects.toThrow('Email already exists');
    });

    it('should trim and lowercase email', async () => {
      const result = await service.createUser({
        email: '  Test@Example.COM  ',
        name: 'User',
      });
      expect(result.email).toBe('test@example.com');
    });
  });

  describe('getUser', () => {
    it('should return null for non-existent user', async () => {
      const result = await service.getUser('nonexistent-id');
      expect(result).toBeNull();
    });
  });
});
\`\`\`

### Coverage Summary
| Category | Tests | Scenarios |
|----------|-------|-----------|
| Happy path | 3 | Create, read, update |
| Edge cases | 2 | Duplicate email, empty name |
| Error handling | 2 | Not found, invalid input |
| **Total** | **7** | |

${inputSummary ? `## Test Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for AI-generated tests against your actual source code.*`;
}

function sandboxSummary(stepName: string, skillName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Summary — ${skillName}

### Overview
This analysis covers the submitted changes across 12 files (8 modified, 3 added, 1 deleted). The changes primarily affect the authentication module and user management service.

### Key Changes
1. **Authentication flow refactored** to support OAuth 2.0 PKCE alongside existing session-based auth
2. **New middleware** added for rate limiting on public API endpoints
3. **Database migration** adds \`refresh_token\` column to users table
4. **Deprecated endpoint** \`/api/v1/login\` marked for removal in next major version

### Risk Assessment
- **Breaking change risk**: Low — new auth flow is additive, old sessions still honored
- **Data migration risk**: Medium — \`refresh_token\` column requires backfill for existing users
- **Rollback plan**: Feature-flagged behind \`ENABLE_OAUTH_PKCE\`

### Reviewer Checklist
- [ ] Verify migration is reversible
- [ ] Check rate limit thresholds match production traffic patterns
- [ ] Confirm OAuth callback URLs are allowlisted
- [ ] Validate refresh token rotation logic

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for AI-generated analysis of your actual changes.*`;
}

function sandboxAnalysis(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Analysis Results

### Code Structure
- **Entry points**: 3 public functions, 2 exported classes
- **Complexity**: Cyclomatic complexity 14 (moderate — consider extracting helper functions above 10)
- **Dependencies**: 6 external imports, 4 internal modules

### Logic Branches Identified
| Branch | Condition | Test Coverage |
|--------|-----------|---------------|
| Auth check | \`user.isAuthenticated\` | ✅ Covered |
| Admin override | \`user.role === 'admin'\` | ✅ Covered |
| Rate limit bypass | \`config.skipRateLimit\` | ⚠️ Missing |
| Fallback handler | \`catch (err)\` | ⚠️ Partial |
| Edge: empty input | \`items.length === 0\` | ❌ Not covered |

### Recommendations
1. Add guard clause for empty array input
2. Extract the nested conditional in \`processOrder()\` into a strategy pattern
3. The fallback handler swallows errors silently — log or re-throw

${inputSummary ? `## Analysis Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for actual code analysis.*`;
}

function sandboxMetadata(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Metadata Retrieved

| Field | Value |
|-------|-------|
| **Title** | feat: Add OAuth 2.0 PKCE authentication flow |
| **Author** | developer@example.com |
| **Branch** | feature/oauth-pkce → main |
| **Files Changed** | 12 (8 modified, 3 added, 1 deleted) |
| **Lines** | +342 / -89 |
| **Labels** | \`feature\`, \`auth\`, \`needs-review\` |
| **CI Status** | ✅ All checks passed |
| **Created** | 2 hours ago |

### Changed File Categories
- **Auth module** (5 files): Core flow changes
- **Middleware** (2 files): Rate limiting
- **Database** (2 files): Migration + model update
- **Tests** (2 files): New test coverage
- **Config** (1 file): Environment variables

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — connect GitHub and run Live to fetch real PR data.*`;
}

function sandboxSuggestions(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Inline Suggestions

### Suggestion 1 — \`src/auth/oauth.ts:42\`
\`\`\`diff
- const token = jwt.sign(payload, SECRET);
+ const token = jwt.sign(payload, SECRET, { expiresIn: '15m', algorithm: 'RS256' });
\`\`\`
**Reason:** Token has no expiration — set a reasonable TTL and use asymmetric signing.

### Suggestion 2 — \`src/middleware/rate-limit.ts:18\`
\`\`\`diff
- const limit = 100;
+ const limit = parseInt(process.env.RATE_LIMIT ?? '100', 10);
\`\`\`
**Reason:** Make rate limit configurable via environment for different deployment tiers.

### Suggestion 3 — \`src/db/queries.ts:67\`
\`\`\`diff
- const users = await db.query(\`SELECT * FROM users WHERE org = '\${orgId}'\`);
+ const users = await db.query('SELECT * FROM users WHERE org = $1', [orgId]);
\`\`\`
**Reason:** SQL injection vulnerability — use parameterized query.

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for suggestions based on your actual diff.*`;
}

function sandboxArchitecture(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Architecture Analysis

### System Components
\`\`\`
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend   │────▶│  API Gateway  │────▶│  Auth Service│
│  (React SPA) │     │  (Express)    │     │  (OAuth 2.0) │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────┴───────┐
                    │              │
              ┌─────▼────┐  ┌─────▼────┐
              │  User     │  │  Order    │
              │  Service  │  │  Service  │
              └─────┬────┘  └─────┬────┘
                    │              │
              ┌─────▼──────────────▼────┐
              │     PostgreSQL DB        │
              └─────────────────────────┘
\`\`\`

### Design Patterns Identified
- **API Gateway pattern** for request routing and auth
- **Service layer** with domain separation (users, orders)
- **Repository pattern** for data access abstraction

### Recommendations
1. Consider event-driven communication between User and Order services
2. Add a caching layer (Redis) for frequently-accessed catalog data
3. Introduce circuit breaker for external service calls

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for analysis of your actual architecture.*`;
}

function sandboxPlan(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Roadmap & Timeline

### Phase 1 — Foundation (Weeks 1–2)
- [ ] Set up project scaffolding and CI/CD pipeline
- [ ] Define API contracts and data models
- [ ] Implement core authentication flow
- [ ] Set up monitoring and alerting baseline

### Phase 2 — Core Features (Weeks 3–5)
- [ ] Build primary user-facing workflows
- [ ] Implement data access layer with migrations
- [ ] Add integration tests for critical paths
- [ ] Performance baseline and load testing

### Phase 3 — Polish & Launch (Weeks 6–7)
- [ ] UI/UX refinements based on internal testing
- [ ] Security audit and penetration testing
- [ ] Documentation for API consumers
- [ ] Staged rollout plan with feature flags

### Milestones
| Milestone | Target | Status |
|-----------|--------|--------|
| Alpha | Week 3 | ⬜ Not started |
| Beta | Week 5 | ⬜ Not started |
| GA | Week 7 | ⬜ Not started |

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for AI-generated planning tailored to your project.*`;
}

function sandboxDocumentation(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Generated Documentation

### API Reference

#### \`POST /api/v2/users\`
Creates a new user account.

**Request Body:**
\`\`\`json
{
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "member"
}
\`\`\`

**Response (201):**
\`\`\`json
{
  "id": "usr_abc123",
  "email": "user@example.com",
  "name": "Jane Doe",
  "role": "member",
  "createdAt": "2025-01-15T10:30:00Z"
}
\`\`\`

**Error Responses:**
| Code | Description |
|------|-------------|
| 400 | Invalid email format or missing required fields |
| 409 | Email already registered |
| 429 | Rate limit exceeded |

### Quick Start
\`\`\`bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env

# Run migrations
npm run db:migrate

# Start development server
npm run dev
\`\`\`

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for documentation generated from your actual code.*`;
}

function sandboxRequirements(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## Requirements Specification

### User Stories

**US-001: User Registration**
> As a new user, I want to create an account with my email so that I can access the platform.

**Acceptance Criteria:**
- [ ] User can register with email and password
- [ ] Email validation prevents invalid formats
- [ ] Duplicate emails show clear error message
- [ ] Welcome email sent on successful registration
- [ ] Account is created in "pending" state until email verified

**US-002: Dashboard Overview**
> As a logged-in user, I want to see a dashboard with my key metrics so that I can quickly understand my status.

**Acceptance Criteria:**
- [ ] Dashboard loads within 2 seconds
- [ ] Shows 4 KPI cards with real-time data
- [ ] Supports date range filtering (7d, 30d, 90d)
- [ ] Data refreshes automatically every 60 seconds

### Non-Functional Requirements
| Category | Requirement |
|----------|-------------|
| Performance | P95 API latency < 200ms |
| Availability | 99.9% uptime SLA |
| Security | SOC 2 Type II compliance |
| Scale | Support 10K concurrent users |

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for requirements generated from your actual inputs.*`;
}

function sandboxPipeline(stepName: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation

## CI/CD Pipeline Configuration

\`\`\`yaml
name: Deploy Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test
      - run: npm run lint

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t app:$GITHUB_SHA .
      - run: docker push registry.example.com/app:$GITHUB_SHA

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: kubectl set image deployment/app app=registry.example.com/app:$GITHUB_SHA
\`\`\`

### Pipeline Stages
| Stage | Duration | Gate |
|-------|----------|------|
| Lint + Test | ~2min | Auto |
| Build + Push | ~3min | Auto |
| Deploy Staging | ~1min | Auto |
| Deploy Production | ~1min | Manual approval |

${inputSummary ? `## Context\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run Live for pipeline config tailored to your stack.*`;
}

function sandboxGeneric(stepName: string, skillName: string, persona: string, inputSummary: string): string {
  return `# ${stepName}
**Mode:** 🧪 Sandbox Simulation
**Skill:** ${skillName} | **Persona:** ${persona}

## Output

### Analysis
This step analyzed the provided inputs and produced the following structured output:

**Key Findings:**
1. The primary objective has been identified and decomposed into 4 actionable work items
2. Dependencies mapped across 3 related systems
3. Risk factors assessed with mitigation strategies for each

**Recommendations:**
- Start with the highest-impact, lowest-risk item to build momentum
- Schedule a review checkpoint after the first deliverable
- Document assumptions explicitly to reduce rework

### Next Steps
| Priority | Action | Owner | ETA |
|----------|--------|-------|-----|
| P0 | Validate core assumptions with stakeholders | Lead | Day 1 |
| P1 | Prototype the primary workflow | Engineering | Week 1 |
| P2 | Set up monitoring for success metrics | DevOps | Week 1 |
| P3 | Draft rollback plan | Lead | Week 2 |

${inputSummary ? `## Inputs Received\n${inputSummary}` : ''}

> 🧪 *Sandbox output — run with Live mode for AI-generated content specific to your inputs.*`;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

function buildStepPrompt(
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  skillName: string,
  step: SkillStep,
  inputs: Record<string, unknown>,
  previousOutputs: Record<string, string>,
  customPrompt?: string,
  agentIdentity?: AgentIdentity
): { system: string; user: string } {
  const inputLines = Object.entries(inputs)
    .filter(([k, v]) => v !== undefined && v !== '' && v !== null)
    .map(([k, v]) => {
      const label = k.replace(/_/g, ' ');
      const val = Array.isArray(v) ? v.join(', ') : String(v);
      return `**${label}**: ${val}`;
    })
    .join('\n');

  const prevContext =
    Object.keys(previousOutputs).length > 0
      ? '\n\n## Context from Previous Steps\n\n' +
        Object.entries(previousOutputs)
          .map(([k, v]) => `### ${k.replace(/_/g, ' ')}\n${v.slice(0, 800)}${v.length > 800 ? '\n...[truncated]' : ''}`)
          .join('\n\n')
      : '';

  // Agent identity injection — if we have a registered agent, use their system prompt
  let system: string;
  if (agentIdentity) {
    const qualitySection = agentIdentity.qualityGates.length > 0
      ? `\n\nQuality Gates (you MUST verify before delivering output):\n${agentIdentity.qualityGates.map(g => `- ${g}`).join('\n')}`
      : '';
    const outputSection = agentIdentity.handoffOutputSchema.length > 0
      ? `\n\nExpected Output Sections:\n${agentIdentity.handoffOutputSchema.map(s => `- ${s}`).join('\n')}`
      : '';
    const memoryContext = buildAgentMemoryContext(agentIdentity.id);

    system = `${agentIdentity.systemPrompt}

You are executing the "${skillName}" skill, step: "${step.name}".

Your rank: ${agentIdentity.rank.replace('-', ' ').toUpperCase()}
Your regiment: ${agentIdentity.regiment}
You report to: ${agentIdentity.escalatesTo}${qualitySection}${outputSection}${memoryContext}

Guidelines:
- Be concrete and specific — no generic filler
- Your output must meet ALL quality gates listed above
- Include the expected output sections in your response
- Output should be ready for review by your commanding officer
- Include actionable recommendations backed by evidence`;
  } else {
    const personaDescriptions: Record<string, string> = {
      engineering: 'expert software engineer and technical lead',
      product: 'expert product manager and strategist',
      hr: 'expert HR professional and people operations leader',
      marketing: 'expert marketing strategist and campaign manager',
    };
    const desc = personaDescriptions[persona] ?? 'expert professional';
    system = `You are an ${desc} working inside AgentOS, an AI operating system.

You are executing the "${skillName}" skill. Produce high-quality, specific, immediately usable output.

Guidelines:
- Be concrete and specific — no generic filler
- Format output with clear sections, headers, and bullet points where appropriate
- Write in a professional, technical tone appropriate for your audience
- Output should be ready to review and use with minimal editing
- Include actionable recommendations and specific details`;
  }

  const customSection = customPrompt
    ? `\n\n## Additional Instructions (from selected prompt)\n${customPrompt}`
    : '';

  let rawUser = `## Skill Step: ${step.name}

## User Inputs
${inputLines || 'No structured inputs provided.'}${prevContext}${customSection}

Please execute this step now. Produce specific, high-quality output for: "${step.name}".`;

  // PII redaction — strip sensitive data before it leaves the process
  if (containsPII(rawUser)) {
    rawUser = redactPII(rawUser).text;
  }

  return { system, user: rawUser };
}

// ---------------------------------------------------------------------------
// Execution Runtime
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Adaptive Agent Routing — select best-performing agent for a role
// ---------------------------------------------------------------------------

/**
 * Find the best available agent for a given role within the same persona.
 * If the assigned agent has a quality score below the threshold AND alternative
 * agents in the same persona have higher scores, swap to the better agent.
 */
function selectBestAgent(defaultAgentId: string, persona: string): string {
  const kpi = agentKPIs.get(defaultAgentId);
  // Need at least 3 executions to have meaningful KPI data
  if (!kpi || kpi.totalExecutions < 3) return defaultAgentId;

  const QUALITY_THRESHOLD = 6.0; // Below this, look for alternatives
  if (kpi.avgQualityScore >= QUALITY_THRESHOLD) return defaultAgentId;

  // Find alternative agents in the same persona with better scores
  const defaultAgent = getAgentIdentity(defaultAgentId);
  if (!defaultAgent) return defaultAgentId;

  const candidates = getAgentsByPersona(defaultAgent.persona)
    .filter(a => a.id !== defaultAgentId && a.rank === defaultAgent.rank)
    .map(a => ({ agent: a, kpi: agentKPIs.get(a.id) }))
    .filter(c => c.kpi && c.kpi.totalExecutions >= 3 && c.kpi.avgQualityScore > kpi.avgQualityScore)
    .sort((a, b) => (b.kpi!.avgQualityScore - a.kpi!.avgQualityScore));

  if (candidates.length > 0) {
    const best = candidates[0]!;
    console.log(`[adaptive-routing] Swapping ${defaultAgentId} (quality: ${kpi.avgQualityScore.toFixed(1)}) → ${best.agent.id} (quality: ${best.kpi!.avgQualityScore.toFixed(1)})`);
    return best.agent.id;
  }

  return defaultAgentId;
}

async function processSkillSteps(
  execId: string,
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  skill: PersonaSkillDef,
  inputs: Record<string, unknown>,
  simulate: boolean,
  customPrompt?: string,
  provider?: LLMProviderId,
  modelId?: string
): Promise<void> {
  const exec = executions.get(execId);
  if (!exec) return;

  exec.status = 'running';

  // Determine execution mode: if skill has edges or steps have dependsOn, use DAG
  const hasEdges = skill.edges && skill.edges.length > 0;
  const hasDependsOn = skill.steps.some(s => s.dependsOn && s.dependsOn.length > 0);
  if (hasEdges || hasDependsOn) {
    exec.executionMode = 'dag';
    if (hasEdges) exec.edges = skill.edges;
    // Populate dependsOn on step records from skill steps
    for (let i = 0; i < skill.steps.length; i++) {
      const ss = skill.steps[i];
      const sr = exec.steps[i];
      if (ss?.dependsOn && sr) sr.dependsOn = ss.dependsOn;
    }
    // If edges are defined but dependsOn is not, derive dependsOn from edges
    if (hasEdges && !hasDependsOn) {
      for (const edge of skill.edges!) {
        const sr = exec.steps.find(s => s.stepId === edge.to);
        if (sr) {
          sr.dependsOn = sr.dependsOn ?? [];
          if (!sr.dependsOn.includes(edge.from)) sr.dependsOn.push(edge.from);
        }
      }
    }
  }

  persistExec(exec);

  const previousOutputs: Record<string, string> = {};
  let totalTokenCost = 0;
  let totalLatencyMs = 0;
  const qualityScores: number[] = [];
  /** Track which agents were swapped via adaptive routing */
  const routedAgents = new Set<string>();

  if (exec.executionMode === 'dag') {
    // ─── DAG Execution: parallel steps with dependency resolution ───
    await processDAGSteps(exec, skill, persona, inputs, simulate, customPrompt, provider, modelId, previousOutputs, qualityScores, routedAgents);
    totalTokenCost = exec.steps.reduce((s, st) => s + (st.tokenCost ?? 0), 0);
    totalLatencyMs = exec.steps.reduce((s, st) => s + (st.latencyMs ?? 0), 0);
  } else {
    // ─── Sequential Execution: step-by-step with handoff enforcement ───
    for (let i = 0; i < skill.steps.length; i++) {
      const skillStep = skill.steps[i];
      const stepRecord = exec.steps[i];
      if (!skillStep || !stepRecord) continue;

      const result = await executeSingleStep(
        exec, persona, skill.name, skillStep, stepRecord, inputs, previousOutputs,
        simulate, customPrompt, provider, modelId, routedAgents
      );

      totalTokenCost += result.tokenCost;
      totalLatencyMs += result.latencyMs;
      if (result.qualityScore !== undefined) qualityScores.push(result.qualityScore);

      // ── Handoff Enforcement ──
      // If this step failed handoff validation, attempt a single retry with explicit instructions
      if (i < skill.steps.length - 1 && stepRecord.status === 'completed') {
        const nextStep = skill.steps[i + 1];
        if (nextStep) {
          const handoffResult = validateHandoff(skillStep.agent, nextStep.agent, previousOutputs[skillStep.outputKey] ?? '');
          stepRecord.handoffValid = handoffResult.valid;
          stepRecord.handoffWarnings = handoffResult.warnings;

          if (!handoffResult.valid && !simulate) {
            console.warn(`[handoff-enforcement] ${skillStep.agent} → ${nextStep.agent} FAILED — missing: ${handoffResult.missingFields.join(', ')}. Retrying with explicit instructions.`);
            // Retry once with explicit handoff instructions
            const retryResult = await retryStepWithHandoffInstructions(
              exec, persona, skill.name, skillStep, stepRecord, inputs, previousOutputs,
              handoffResult.missingFields, provider, modelId
            );
            if (retryResult) {
              const recheck = validateHandoff(skillStep.agent, nextStep.agent, retryResult.output);
              stepRecord.handoffValid = recheck.valid;
              stepRecord.handoffWarnings = recheck.warnings;
              if (recheck.valid) {
                console.log(`[handoff-enforcement] Retry succeeded for ${skillStep.agent} → ${nextStep.agent}`);
              } else {
                console.warn(`[handoff-enforcement] Retry still failed for ${skillStep.agent} → ${nextStep.agent} — proceeding with warnings`);
              }
            }
          }
        }
      }

      // Stop on failure
      if (stepRecord.status === 'failed') break;

      persistExec(exec);
    }
  }

  // Aggregate metrics
  exec.totalTokenCost = totalTokenCost;
  exec.totalLatencyMs = totalLatencyMs;
  exec.avgQualityScore = qualityScores.length > 0
    ? Math.round((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) * 10) / 10
    : undefined;

  const anyFailed = exec.steps.some((s) => s.status === 'failed');
  exec.status = anyFailed ? 'failed' : 'completed';
  exec.completedAt = new Date().toISOString();
  persistExec(exec);

  // Record to KPI store
  recordExecutionMetrics(exec);

  // Generate After-Action Report
  generateAfterActionReport(exec, routedAgents);

  // Check for retraining triggers
  checkRetrainingTriggers(exec);

  // ── UTCP: Finalize task packet ──
  try {
    if (exec.utcpTaskId) {
      const packet = getPacket(exec.utcpTaskId);
      if (packet) {
        const updated = updatePacketStatus(packet, anyFailed ? 'failed' : 'completed', {
          confidence: exec.avgQualityScore ? exec.avgQualityScore / 10 : 0.8,
          progress: 100,
        } as any);
        storePacket(updated);
      }
    }
  } catch {}

  // ── Memory Graph: Record execution + agent performance + entity graph ──
  try {
    const execRecord = {
      userId: exec.userId || 'system',
      skillId: exec.skillId,
      skillName: exec.skillName,
      personaId: exec.persona,
      success: !anyFailed,
      runtimeSec: (exec.totalLatencyMs || 0) / 1000,
      cost: exec.totalTokenCost || 0,
      agentsUsed: exec.steps.map(s => s.agent),
      toolsUsed: exec.steps.filter(s => s.tool).map(s => s.tool!),
      outputs: Object.keys(exec.outputs),
    };
    memoryGraph.recordExecution(execRecord);
    memoryGraph.buildGraphFromExecution({ ...execRecord, id: exec.id, ts: new Date().toISOString() });

    for (const step of exec.steps) {
      if (step.status === 'completed' || step.status === 'approval_required') {
        memoryGraph.updateAgentPerformance(step.agent, step.agentCallSign || step.agent, '', {
          success: true,
          confidence: (step.qualityScore || 5) / 10,
          latencyMs: step.latencyMs || 0,
          costUsd: step.tokenCost || 0,
          tokens: 0,
          skillId: exec.skillId,
        });
      }
    }
  } catch {}

  // ── Event Bus: Execution completed ──
  eventBus.emit('execution.completed', {
    execId: exec.id, persona: exec.persona, status: exec.status,
    utcpTaskId: exec.utcpTaskId, cost: exec.totalTokenCost,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// DAG Execution Engine — parallel step execution with dependency resolution
// ---------------------------------------------------------------------------

async function processDAGSteps(
  exec: PersonaExecutionRecord,
  skill: PersonaSkillDef,
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  inputs: Record<string, unknown>,
  simulate: boolean,
  customPrompt: string | undefined,
  provider: LLMProviderId | undefined,
  modelId: string | undefined,
  previousOutputs: Record<string, string>,
  qualityScores: number[],
  routedAgents: Set<string>
): Promise<void> {
  const completedSteps = new Set<string>();
  const failedSteps = new Set<string>();
  const MAX_ITERATIONS = skill.steps.length + 1; // safety bound

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    // Find ready steps: not yet completed/failed, all dependencies satisfied
    const readySteps: Array<{ skillStep: typeof skill.steps[0]; stepRecord: typeof exec.steps[0] }> = [];

    for (let i = 0; i < skill.steps.length; i++) {
      const ss = skill.steps[i]!;
      const sr = exec.steps[i]!;
      if (completedSteps.has(ss.id) || failedSteps.has(ss.id)) continue;
      if (sr.status === 'running') continue;

      const deps = sr.dependsOn ?? [];
      const allDepsMet = deps.every(d => completedSteps.has(d));
      const anyDepFailed = deps.some(d => failedSteps.has(d));

      if (anyDepFailed) {
        sr.status = 'skipped';
        sr.completedAt = new Date().toISOString();
        sr.error = 'Skipped — upstream dependency failed';
        failedSteps.add(ss.id);
        persistExec(exec);
        continue;
      }

      if (allDepsMet) {
        readySteps.push({ skillStep: ss, stepRecord: sr });
      }
    }

    if (readySteps.length === 0) break; // all done or deadlocked

    // Execute all ready steps in parallel
    await Promise.all(
      readySteps.map(async ({ skillStep, stepRecord }) => {
        const result = await executeSingleStep(
          exec, persona, skill.name, skillStep, stepRecord, inputs, previousOutputs,
          simulate, customPrompt, provider, modelId, routedAgents
        );
        if (result.qualityScore !== undefined) qualityScores.push(result.qualityScore);

        if (stepRecord.status === 'completed' || stepRecord.status === 'approval_required') {
          completedSteps.add(skillStep.id);
        } else {
          failedSteps.add(skillStep.id);
        }
      })
    );

    persistExec(exec);
  }
}

// ---------------------------------------------------------------------------
// Single Step Executor — shared between sequential and DAG modes
// ---------------------------------------------------------------------------

interface StepResult {
  tokenCost: number;
  latencyMs: number;
  qualityScore?: number;
}

async function executeSingleStep(
  exec: PersonaExecutionRecord,
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  skillName: string,
  skillStep: { id: string; name: string; agent: string; tool?: string; outputKey: string; requiresApproval?: boolean },
  stepRecord: PersonaExecutionRecord['steps'][0],
  inputs: Record<string, unknown>,
  previousOutputs: Record<string, string>,
  simulate: boolean,
  customPrompt?: string,
  provider?: LLMProviderId,
  modelId?: string,
  routedAgents?: Set<string>
): Promise<StepResult> {
  // Adaptive agent routing
  const resolvedAgentId = selectBestAgent(skillStep.agent, persona);
  const agentIdentity = getAgentIdentity(resolvedAgentId);
  const wasRouted = resolvedAgentId !== skillStep.agent;
  if (wasRouted && routedAgents) routedAgents.add(resolvedAgentId);

  if (agentIdentity) {
    stepRecord.agent = resolvedAgentId;
    stepRecord.agentCallSign = agentIdentity.callSign;
    stepRecord.agentRank = agentIdentity.rank;
  }

  stepRecord.status = 'running';
  stepRecord.startedAt = new Date().toISOString();
  persistExec(exec);

  // ── A2A: Create delegation message from previous agent ──
  try {
    const stepIdx = exec.steps.indexOf(stepRecord);
    if (stepIdx > 0) {
      const prev = exec.steps[stepIdx - 1];
      const a2aMsg = createA2AMessage({
        type: 'delegate',
        sender: { agent_id: prev.agent, name: prev.agentCallSign || prev.agent, regiment: '', rank: prev.agentRank || '', persona },
        receiver: { agent_id: resolvedAgentId, name: agentIdentity?.callSign || resolvedAgentId, regiment: '', rank: agentIdentity?.rank || '', persona },
        task_ref: exec.utcpTaskId || exec.id,
        payload: { objective: skillStep.name, context: { step: stepIdx } },
      });
      storeMessage(a2aMsg);
    }
  } catch {}

  // ── Event Bus: Step started ──
  eventBus.emit('execution.step.started', { execId: exec.id, stepId: skillStep.id, agent: resolvedAgentId }).catch(() => {});

  const stepStart = Date.now();

  try {
    let output: string;
    let llmResponse: LLMResponse | undefined;

    if (simulate) {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 800));
      output = generateSandboxOutput(persona, skillName, skillStep as any, inputs, previousOutputs);
    } else {
      const { system, user } = buildStepPrompt(persona, skillName, skillStep as any, inputs, previousOutputs, customPrompt, agentIdentity);
      llmResponse = await callLLMUnified(system, user, provider, modelId, persona);
      output = llmResponse.content;
    }

    previousOutputs[skillStep.outputKey] = output;
    exec.outputs[skillStep.outputKey] = output;

    const latencyMs = Date.now() - stepStart;
    stepRecord.latencyMs = latencyMs;
    const tokenCost = llmResponse?.cost ?? 0;
    stepRecord.tokenCost = tokenCost;

    if (llmResponse) {
      exec.provider = llmResponse.provider;
      exec.model = llmResponse.model;
    }

    const qualityScore = computeQualityScore(output, agentIdentity);
    stepRecord.qualityScore = qualityScore;

    if (agentIdentity) {
      extractAndStoreMemory(agentIdentity.id, exec.id, skillStep.name, output);
    }

    stepRecord.outputKey = skillStep.outputKey;
    stepRecord.outputPreview = output.slice(0, 300);

    // ── A2A: Approval request if step requires human approval ──
    if (skillStep.requiresApproval) {
      try {
        const approvalMsg = createA2AMessage({
          type: 'approve',
          sender: { agent_id: resolvedAgentId, name: agentIdentity?.callSign || resolvedAgentId, regiment: '', rank: agentIdentity?.rank || '', persona },
          receiver: { agent_id: 'human-approver', name: 'Human Approver', regiment: 'Command', rank: 'Colonel', persona },
          task_ref: exec.utcpTaskId || exec.id,
          payload: { objective: `Approve: ${skillStep.name}`, context: { outputPreview: output.slice(0, 1000) } },
          priority: 'high',
        });
        storeMessage(approvalMsg);
      } catch {}
    }

    // ── Human-in-the-loop gate ──
    // Real executions PAUSE here until a human approves/rejects via
    // POST /api/executions/:id/{approve,reject}/:stepId (resolved through the
    // approval bus). The background pipeline blocks, so dependent steps do not
    // run and the side-effecting tool call below is gated behind approval.
    // Simulation mode never blocks (no human to approve) — it surfaces the
    // approval state for the UI and proceeds.
    if (skillStep.requiresApproval && !simulate) {
      stepRecord.status = 'approval_required';
      exec.status = 'paused';
      persistExec(exec);
      const decision = await waitForApproval(exec.id, stepRecord.stepId, {
        stepName: skillStep.name,
        requesterId: resolvedAgentId,
      });
      if (!decision.approved) {
        stepRecord.status = 'rejected';
        stepRecord.error = decision.reason ?? 'Rejected by approver';
        stepRecord.completedAt = new Date().toISOString();
        exec.status = 'running';
        persistExec(exec);
        eventBus.emit('execution.step.completed', { execId: exec.id, stepId: skillStep.id, agent: resolvedAgentId, status: 'rejected' }).catch(() => {});
        return { tokenCost, latencyMs, qualityScore };
      }
      exec.status = 'running';
    }

    // ── MCP: Record tool call if step uses a non-LLM tool (gated behind approval) ──
    if (skillStep.tool && skillStep.tool !== 'Claude' && !simulate) {
      try {
        const mcpAction = createMCPAction({
          tool_id: skillStep.tool.toLowerCase().replace(/\s+/g, '-'),
          action: 'execute' as any,
          resource_type: 'skill-step',
          params: { stepName: skillStep.name, outputPreview: output.slice(0, 500) },
          task_ref: exec.utcpTaskId || exec.id,
          agent_id: resolvedAgentId,
          step_index: exec.steps.indexOf(stepRecord),
        });
        await executeMCPAction(mcpAction);
      } catch {}
    }

    stepRecord.status = skillStep.requiresApproval && simulate ? 'approval_required' : 'completed';
    stepRecord.completedAt = new Date().toISOString();

    // ── Event Bus: Step completed ──
    eventBus.emit('execution.step.completed', { execId: exec.id, stepId: skillStep.id, agent: resolvedAgentId, status: stepRecord.status }).catch(() => {});

    return { tokenCost, latencyMs, qualityScore };

  } catch (err) {
    stepRecord.status = 'failed';
    stepRecord.completedAt = new Date().toISOString();
    stepRecord.latencyMs = Date.now() - stepStart;
    stepRecord.error = err instanceof Error ? err.message : 'Step failed';
    console.error(`[persona-api] Step ${skillStep.id} failed:`, err);
    return { tokenCost: 0, latencyMs: Date.now() - stepStart };
  }
}

// ---------------------------------------------------------------------------
// Handoff Enforcement — retry step with explicit schema instructions
// ---------------------------------------------------------------------------

async function retryStepWithHandoffInstructions(
  exec: PersonaExecutionRecord,
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  skillName: string,
  skillStep: { id: string; name: string; agent: string; outputKey: string },
  stepRecord: PersonaExecutionRecord['steps'][0],
  inputs: Record<string, unknown>,
  previousOutputs: Record<string, string>,
  missingFields: string[],
  provider?: LLMProviderId,
  modelId?: string
): Promise<{ output: string } | null> {
  const agentIdentity = getAgentIdentity(stepRecord.agent);
  const originalOutput = previousOutputs[skillStep.outputKey] ?? '';

  const fixPrompt = `Your previous output is missing required sections for the downstream agent handoff.

Missing sections: ${missingFields.join(', ')}

Your original output (for reference):
${originalOutput.slice(0, 2000)}

Please rewrite your output to explicitly include ALL of these sections: ${missingFields.join(', ')}.
Keep everything else from your original output that was good.`;

  try {
    const systemPrompt = agentIdentity?.systemPrompt ?? `You are an expert ${persona} professional.`;
    const llmResponse = await callLLMUnified(
      systemPrompt + '\n\nIMPORTANT: You are retrying a step because your previous output was missing required handoff sections.',
      fixPrompt, provider, modelId
    );

    previousOutputs[skillStep.outputKey] = llmResponse.content;
    exec.outputs[skillStep.outputKey] = llmResponse.content;
    stepRecord.outputPreview = llmResponse.content.slice(0, 300);

    if (llmResponse.cost) {
      stepRecord.tokenCost = (stepRecord.tokenCost ?? 0) + llmResponse.cost;
    }

    return { output: llmResponse.content };
  } catch (err) {
    console.error(`[handoff-enforcement] Retry failed for ${skillStep.id}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// After-Action Report Generator
// ---------------------------------------------------------------------------

function generateAfterActionReport(exec: PersonaExecutionRecord, routedAgents: Set<string>): void {
  const totalDuration = exec.completedAt && exec.startedAt
    ? new Date(exec.completedAt).getTime() - new Date(exec.startedAt).getTime()
    : exec.totalLatencyMs ?? 0;

  const completedSteps = exec.steps.filter(s => s.status === 'completed' || s.status === 'approval_required');
  const failedSteps = exec.steps.filter(s => s.status === 'failed');
  const skippedSteps = exec.steps.filter(s => s.status === 'skipped');

  // Determine outcome
  let outcome: AfterActionReport['outcome'];
  if (failedSteps.length === 0 && skippedSteps.length === 0) outcome = 'success';
  else if (completedSteps.length > 0) outcome = 'partial';
  else outcome = 'failure';

  // Build agent performance breakdown
  const agentPerformance = exec.steps.map(step => ({
    agentId: step.agent,
    callSign: step.agentCallSign ?? step.agent,
    rank: step.agentRank ?? 'unknown',
    stepName: step.stepName,
    status: step.status,
    durationMs: step.latencyMs ?? 0,
    qualityScore: step.qualityScore ?? 0,
    tokenCost: step.tokenCost ?? 0,
    handoffValid: step.handoffValid !== false,
    handoffWarnings: step.handoffWarnings ?? [],
    wasRouted: routedAgents.has(step.agent),
  }));

  // Build handoff chain
  const handoffChain: AfterActionReport['handoffChain'] = [];
  for (let i = 0; i < exec.steps.length - 1; i++) {
    const from = exec.steps[i]!;
    const to = exec.steps[i + 1]!;
    handoffChain.push({
      from: from.agentCallSign ?? from.agent,
      to: to.agentCallSign ?? to.agent,
      valid: from.handoffValid !== false,
      missingFields: from.handoffWarnings?.filter(w => w.includes('Missing')) ? [] : [],
    });
  }

  // Identify issues
  const issues: string[] = [];
  for (const step of failedSteps) {
    issues.push(`Step "${step.stepName}" failed: ${step.error ?? 'Unknown error'}`);
  }
  for (const step of exec.steps) {
    if (step.handoffValid === false) {
      issues.push(`Handoff from ${step.agentCallSign ?? step.agent} failed validation — ${(step.handoffWarnings ?? []).join('; ')}`);
    }
    if (step.qualityScore !== undefined && step.qualityScore < 5) {
      issues.push(`Low quality output from ${step.agentCallSign ?? step.agent} (score: ${step.qualityScore}/10)`);
    }
    if (step.latencyMs && step.latencyMs > 30000) {
      issues.push(`Slow step: "${step.stepName}" took ${(step.latencyMs / 1000).toFixed(1)}s`);
    }
  }

  // Recommendations
  const recommendations: string[] = [];
  if (failedSteps.length > 0) {
    recommendations.push('Review failed steps for prompt improvements or tool connectivity issues');
  }
  const slowSteps = exec.steps.filter(s => (s.latencyMs ?? 0) > 20000);
  if (slowSteps.length > 0) {
    recommendations.push(`Consider using a faster model for ${slowSteps.map(s => s.stepName).join(', ')}`);
  }
  if (exec.steps.some(s => s.handoffValid === false)) {
    recommendations.push('Refine handoff contracts — some agents are not producing expected output sections');
  }
  if (routedAgents.size > 0) {
    recommendations.push(`${routedAgents.size} agent(s) were auto-swapped via adaptive routing — review KPIs of original agents`);
  }
  if (exec.avgQualityScore !== undefined && exec.avgQualityScore >= 8) {
    recommendations.push('Excellent quality — consider using this execution as a training exemplar');
  }

  // Summary
  const summary = `${exec.skillName} execution ${outcome === 'success' ? 'completed successfully' : outcome === 'partial' ? 'partially completed' : 'failed'}. ` +
    `${completedSteps.length}/${exec.steps.length} steps completed in ${(totalDuration / 1000).toFixed(1)}s. ` +
    `Average quality: ${exec.avgQualityScore?.toFixed(1) ?? 'N/A'}/10. ` +
    `Total cost: $${(exec.totalTokenCost ?? 0).toFixed(4)}.` +
    (issues.length > 0 ? ` ${issues.length} issue(s) identified.` : '');

  const aar: AfterActionReport = {
    id: `aar-${exec.id}`,
    executionId: exec.id,
    persona: exec.persona,
    skillName: exec.skillName,
    generatedAt: new Date().toISOString(),
    outcome,
    totalDurationMs: totalDuration,
    totalTokenCost: exec.totalTokenCost ?? 0,
    summary,
    agentPerformance,
    handoffChain,
    issues,
    recommendations,
  };

  persistAAR(aar);
  console.log(`[aar] Generated After-Action Report ${aar.id} for ${exec.id}: ${outcome}`);
}

// ---------------------------------------------------------------------------
// Retraining Triggers — flag agents with sustained poor performance
// ---------------------------------------------------------------------------

const RETRAIN_THRESHOLDS = {
  quality: { value: 5.0, label: 'low_quality' as const, severity: 'critical' as const },
  handoff: { value: 70, label: 'handoff_failures' as const, severity: 'warning' as const },
  latency: { value: 30000, label: 'high_latency' as const, severity: 'warning' as const },
  cost: { value: 0.50, label: 'high_cost' as const, severity: 'warning' as const },
};

function checkRetrainingTriggers(exec: PersonaExecutionRecord): void {
  for (const step of exec.steps) {
    if (step.status !== 'completed' && step.status !== 'approval_required') continue;

    const agentId = step.agent;
    const kpi = agentKPIs.get(agentId);
    if (!kpi || kpi.totalExecutions < 5) continue; // need enough data

    const identity = getAgentIdentity(agentId);
    const callSign = identity?.callSign ?? agentId;
    const persona = identity?.persona ?? exec.persona;

    // Quality check
    if (kpi.avgQualityScore < RETRAIN_THRESHOLDS.quality.value) {
      flagAgent(agentId, callSign, persona, 'low_quality', kpi.avgQualityScore, RETRAIN_THRESHOLDS.quality.value, 'critical',
        `Prompt refinement needed — average quality ${kpi.avgQualityScore.toFixed(1)}/10 is below threshold. Review system prompt and quality gates.`);
    }

    // Handoff success rate check
    if (kpi.handoffSuccessRate < RETRAIN_THRESHOLDS.handoff.value) {
      flagAgent(agentId, callSign, persona, 'handoff_failures', kpi.handoffSuccessRate, RETRAIN_THRESHOLDS.handoff.value, 'warning',
        `Handoff success rate ${kpi.handoffSuccessRate.toFixed(0)}% is below ${RETRAIN_THRESHOLDS.handoff.value}%. Review handoff output schema and add explicit section headers to system prompt.`);
    }

    // Latency check
    if (kpi.avgLatencyMs > RETRAIN_THRESHOLDS.latency.value) {
      flagAgent(agentId, callSign, persona, 'high_latency', kpi.avgLatencyMs, RETRAIN_THRESHOLDS.latency.value, 'warning',
        `Average latency ${(kpi.avgLatencyMs / 1000).toFixed(1)}s exceeds ${RETRAIN_THRESHOLDS.latency.value / 1000}s. Consider shorter prompts or a faster model.`);
    }

    // Cost check
    if (kpi.avgTokenCost > RETRAIN_THRESHOLDS.cost.value) {
      flagAgent(agentId, callSign, persona, 'high_cost', kpi.avgTokenCost, RETRAIN_THRESHOLDS.cost.value, 'warning',
        `Average cost $${kpi.avgTokenCost.toFixed(3)}/execution is high. Consider using a cheaper model or reducing prompt length.`);
    }
  }
}

function flagAgent(
  agentId: string, callSign: string, persona: string,
  reason: RetrainingFlag['reason'], currentValue: number, threshold: number,
  severity: RetrainingFlag['severity'], suggestedAction: string
): void {
  const existing = retrainingFlags.get(agentId);
  if (existing && existing.reason === reason && existing.acknowledged) return; // already acknowledged

  const flag: RetrainingFlag = {
    agentId, callSign, persona,
    flaggedAt: new Date().toISOString(),
    reason, severity, currentValue, threshold,
    consecutiveFailures: (existing?.reason === reason ? existing.consecutiveFailures + 1 : 1),
    suggestedAction,
    acknowledged: false,
  };

  // Escalate to critical if consecutive failures ≥ 5
  if (flag.consecutiveFailures >= 5) flag.severity = 'critical';

  persistRetrainingFlag(flag);
  console.log(`[retraining] Flagged ${callSign} (${agentId}): ${reason} — ${suggestedAction}`);
}

/** Compute a quality score (0-10) for agent output based on heuristics */
function computeQualityScore(output: string, agent?: AgentIdentity): number {
  let score = 5; // baseline

  // Length check — very short output is likely low quality
  if (output.length > 500) score += 1;
  if (output.length > 1500) score += 1;
  if (output.length > 3000) score += 0.5;
  if (output.length < 100) score -= 2;

  // Structure check — has markdown headers
  const headerCount = (output.match(/^#{1,3} /gm) || []).length;
  if (headerCount >= 2) score += 1;
  if (headerCount >= 4) score += 0.5;

  // Quality gate check — if agent has expected output sections, verify presence
  if (agent?.handoffOutputSchema) {
    const outputLower = output.toLowerCase();
    const covered = agent.handoffOutputSchema.filter(s => outputLower.includes(s.toLowerCase())).length;
    const coverage = covered / agent.handoffOutputSchema.length;
    score += coverage * 2; // up to +2 for full schema coverage
  }

  // Actionability check — has specific items
  if (output.includes('- [') || output.includes('| ')) score += 0.5; // checklists or tables
  if (output.match(/```/g)?.length) score += 0.5; // code blocks

  return Math.min(10, Math.max(0, Math.round(score * 10) / 10));
}

// ---------------------------------------------------------------------------
// KPI Store — tracks agent performance across executions
// ---------------------------------------------------------------------------

interface AgentKPI {
  agentId: string;
  callSign: string;
  totalExecutions: number;
  avgLatencyMs: number;
  avgQualityScore: number;
  avgTokenCost: number;
  handoffSuccessRate: number;
  lastExecutedAt: string;
}

const agentKPIs = new Map<string, AgentKPI>();

function recordExecutionMetrics(exec: PersonaExecutionRecord): void {
  for (const step of exec.steps) {
    if (step.status !== 'completed' && step.status !== 'approval_required') continue;

    const agentId = step.agent;
    const existing = agentKPIs.get(agentId);
    const callSign = step.agentCallSign ?? agentId;

    if (!existing) {
      const kpi: AgentKPI = {
        agentId,
        callSign,
        totalExecutions: 1,
        avgLatencyMs: step.latencyMs ?? 0,
        avgQualityScore: step.qualityScore ?? 5,
        avgTokenCost: step.tokenCost ?? 0,
        handoffSuccessRate: step.handoffValid !== false ? 100 : 0,
        lastExecutedAt: step.completedAt ?? new Date().toISOString(),
      };
      persistKPI(agentId, kpi);
    } else {
      const n = existing.totalExecutions;
      existing.totalExecutions = n + 1;
      existing.avgLatencyMs = (existing.avgLatencyMs * n + (step.latencyMs ?? 0)) / (n + 1);
      existing.avgQualityScore = (existing.avgQualityScore * n + (step.qualityScore ?? 5)) / (n + 1);
      existing.avgTokenCost = (existing.avgTokenCost * n + (step.tokenCost ?? 0)) / (n + 1);
      existing.handoffSuccessRate = (existing.handoffSuccessRate * n + (step.handoffValid !== false ? 100 : 0)) / (n + 1);
      existing.lastExecutedAt = step.completedAt ?? new Date().toISOString();
      persistKPI(agentId, existing);
    }
  }
}

/** Get KPI metrics for all agents */
export function getAgentKPIs(): AgentKPI[] {
  return Array.from(agentKPIs.values()).sort((a, b) => b.totalExecutions - a.totalExecutions);
}

/** Get KPI for a specific agent */
export function getAgentKPI(agentId: string): AgentKPI | undefined {
  return agentKPIs.get(agentId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createPersonaExecution(
  persona: 'engineering' | 'product' | 'hr' | 'marketing',
  skill: PersonaSkillDef,
  inputs: Record<string, unknown>,
  userId?: string,
  simulate?: boolean,
  customPrompt?: string,
  provider?: LLMProviderId,
  modelId?: string
): PersonaExecutionRecord {
  const id = `${persona}-exec-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const steps = skill.steps.map((s) => {
    const identity = getAgentIdentity(s.agent);
    return {
      stepId: s.id,
      stepName: s.name,
      agent: s.agent,
      agentCallSign: identity?.callSign,
      agentRank: identity?.rank,
      tool: s.tool,
      status: 'pending' as const,
      outputKey: s.outputKey,
    };
  });

  const exec: PersonaExecutionRecord = {
    id,
    persona,
    skillId: skill.id,
    skillName: skill.name,
    status: 'queued',
    executionMode: 'sequential',
    provider,
    steps,
    outputs: {},
    inputs,
    startedAt: new Date().toISOString(),
    userId,
  };

  // ── UTCP: Create task packet for this execution ──
  try {
    const utcpPacket = createUTCPPacket({
      function: persona as any,
      stage: 'executing',
      intent: `Execute ${skill.name}`,
      initiator: { user_id: userId || 'system', role: 'operator' },
      objectives: [`Run ${skill.name} skill`],
      tool_scopes: (skill.requiredTools as string[]) || [],
    });
    storePacket(utcpPacket);
    exec.utcpTaskId = utcpPacket.task_id;
  } catch {}

  persistExec(exec);

  // ── Event Bus: Execution started ──
  eventBus.emit('execution.started', { execId: id, persona, skillName: skill.name, utcpTaskId: exec.utcpTaskId }).catch(() => {});

  // ── Task Queue: enqueue instead of fire-and-forget ──
  // Primary agent = first step's agent (falls back to 'unknown')
  const primaryAgent = skill.steps[0]?.agent ?? 'unknown';
  try {
    taskEnqueue({
      taskId: id,
      persona: persona as QueuePersonaId,
      agentId: primaryAgent,
      runFn: 'runSkillExecution',
      payload: {
        execId: id,
        persona,
        skill,
        inputs,
        simulate: simulate ?? false,
        customPrompt,
        provider,
        modelId,
      },
      priority: 50,
      maxAttempts: 1, // execution pipeline has its own retry; queue doesn't re-drive it
    });
  } catch (err) {
    // Fallback: if the queue isn't available (shouldn't happen), run directly
    console.error(`[persona-api] task-queue enqueue failed for ${id}, falling back to direct run:`, err);
    processSkillSteps(id, persona, skill, inputs, simulate ?? false, customPrompt, provider, modelId).catch((err2) => {
      console.error(`[persona-api] processSkillSteps error for ${id}:`, err2);
      const e = executions.get(id);
      if (e) { e.status = 'failed'; persistExec(e); }
    });
  }

  return exec;
}

// ═══════════════════════════════════════════════════════════════
// Task worker entry point — invoked by task-worker.ts after claim()
// ═══════════════════════════════════════════════════════════════

export interface RunSkillExecutionPayload {
  execId: string;
  persona: 'engineering' | 'product' | 'hr' | 'marketing';
  skill: PersonaSkillDef;
  inputs: Record<string, unknown>;
  simulate: boolean;
  customPrompt?: string;
  provider?: LLMProviderId;
  modelId?: string;
}

export async function runSkillExecution(payload: unknown): Promise<void> {
  const p = payload as RunSkillExecutionPayload;
  if (!p || !p.execId || !p.skill) {
    throw new Error('runSkillExecution: invalid payload');
  }
  try {
    await processSkillSteps(p.execId, p.persona, p.skill, p.inputs, p.simulate, p.customPrompt, p.provider, p.modelId);
  } catch (err) {
    console.error(`[persona-api] processSkillSteps error for ${p.execId}:`, err);
    const e = executions.get(p.execId);
    if (e) { e.status = 'failed'; persistExec(e); }
    throw err;
  }
}

export function getPersonaExecution(execId: string): PersonaExecutionRecord | undefined {
  return executions.get(execId);
}

export function listPersonaExecutions(persona: 'engineering' | 'product' | 'hr' | 'marketing', limit = 20): PersonaExecutionRecord[] {
  const all = Array.from(executions.values())
    .filter((e) => e.persona === persona)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit);
  return all;
}

/** Get all executions across all personas (for real metrics) */
export function getAllExecutions(): PersonaExecutionRecord[] {
  return Array.from(executions.values());
}

/** Computed stats from actual execution data */
export function getExecutionStats(): {
  totalExecutions: number;
  byPersona: Record<string, { count: number; totalCost: number; avgQuality: number }>;
  totalCost: number;
  avgQuality: number;
  activeAgents: string[];
} {
  const execs = Array.from(executions.values());
  const byPersona: Record<string, { count: number; totalCost: number; qualitySum: number; qualityCount: number }> = {};

  let totalCost = 0;
  let qualitySum = 0;
  let qualityCount = 0;
  const activeAgentSet = new Set<string>();

  for (const exec of execs) {
    const pc = byPersona[exec.persona] ?? { count: 0, totalCost: 0, qualitySum: 0, qualityCount: 0 };
    pc.count++;
    if (exec.totalTokenCost) { pc.totalCost += exec.totalTokenCost; totalCost += exec.totalTokenCost; }
    if (exec.avgQualityScore) { pc.qualitySum += exec.avgQualityScore; pc.qualityCount++; qualitySum += exec.avgQualityScore; qualityCount++; }
    byPersona[exec.persona] = pc;

    for (const step of exec.steps) {
      if (step.status === 'running') activeAgentSet.add(step.agent);
    }
  }

  const result: Record<string, { count: number; totalCost: number; avgQuality: number }> = {};
  for (const [p, v] of Object.entries(byPersona)) {
    result[p] = { count: v.count, totalCost: v.totalCost, avgQuality: v.qualityCount ? v.qualitySum / v.qualityCount : 0 };
  }

  return {
    totalExecutions: execs.length,
    byPersona: result,
    totalCost,
    avgQuality: qualityCount ? qualitySum / qualityCount : 0,
    activeAgents: Array.from(activeAgentSet),
  };
}

export function approvePersonaStep(execId: string, stepId: string): { success: boolean; message: string } {
  const exec = executions.get(execId);
  if (!exec) return { success: false, message: 'Execution not found' };
  const step = exec.steps.find((s) => s.stepId === stepId);
  if (!step) return { success: false, message: 'Step not found' };
  if (step.status !== 'approval_required') return { success: false, message: 'Step is not awaiting approval' };
  step.status = 'completed';
  persistExec(exec);
  return { success: true, message: 'Step approved' };
}

// ---------------------------------------------------------------------------
// After-Action Report Public API
// ---------------------------------------------------------------------------

/** Get AAR for a specific execution */
export function getAfterActionReport(executionId: string): AfterActionReport | undefined {
  return afterActionReports.get(`aar-${executionId}`);
}

/** List all AARs, optionally filtered by persona */
export function listAfterActionReports(persona?: string, limit = 20): AfterActionReport[] {
  let all = Array.from(afterActionReports.values());
  if (persona) all = all.filter(a => a.persona === persona);
  return all
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Retraining Flags Public API
// ---------------------------------------------------------------------------

/** Get all retraining flags */
export function getRetrainingFlags(): RetrainingFlag[] {
  return Array.from(retrainingFlags.values())
    .sort((a, b) => {
      // Critical first, then by date
      if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
      return new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime();
    });
}

/** Get retraining flag for a specific agent */
export function getRetrainingFlag(agentId: string): RetrainingFlag | undefined {
  return retrainingFlags.get(agentId);
}

/** Acknowledge a retraining flag (marks it as reviewed by a human) */
export function acknowledgeRetrainingFlag(agentId: string): { success: boolean; message: string } {
  const flag = retrainingFlags.get(agentId);
  if (!flag) return { success: false, message: 'No retraining flag for this agent' };
  flag.acknowledged = true;
  persistRetrainingFlag(flag);
  return { success: true, message: `Acknowledged retraining flag for ${flag.callSign}` };
}

/** Dismiss (remove) a retraining flag */
export function dismissRetrainingFlag(agentId: string): { success: boolean; message: string } {
  const flag = retrainingFlags.get(agentId);
  if (!flag) return { success: false, message: 'No retraining flag for this agent' };
  retrainingFlags.delete(agentId);
  if (backingStore) {
    try { backingStore.delete(RETRAIN_TABLE, agentId); } catch { /* ignore */ }
  }
  return { success: true, message: `Dismissed retraining flag for ${flag.callSign}` };
}
