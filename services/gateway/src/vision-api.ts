/**
 * Vision API — C-Suite & Vision-Down Execution Layer
 *
 * Implements the vision-down, output-up architecture:
 *   Vision Statement (human input)
 *     → Mission Decomposition (CEO breaks into strategic objectives)
 *       → OKR Assignment (each C-Suite officer gets relevant OKRs)
 *         → Task Breakdown (Colonels decompose into actionable tasks)
 *           → Skill Execution (Captains/Corporals execute)
 *             → Output Aggregation (flows back up the chain)
 *               → C-Suite Review & Sign-off
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { callLLM as callLLMProvider, type LLMResponse } from './llm-provider.js';
import {
  getAgentIdentity,
  getCSuiteAgents,
  getCSuiteProfile,
  getAllCSuiteProfiles,
  getDirectReports,
  getChainOfCommand,
  type AgentIdentity,
  type CSuiteProfile,
  type OKR,
} from './agent-registry.js';
import type { Store } from './db.js';
import { readAll } from './db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisionStatement {
  id: string;
  statement: string;
  createdBy: string;
  createdAt: string;
  status: 'draft' | 'decomposing' | 'active' | 'completed' | 'archived';
  decomposition?: VisionDecomposition;
  programs: ProgramRecord[];
}

export interface VisionDecomposition {
  visionId: string;
  strategicObjectives: StrategicObjective[];
  decomposedBy: string;       // agent ID (CEO)
  decomposedAt: string;
  rationale: string;
}

export interface StrategicObjective {
  id: string;
  title: string;
  description: string;
  assignedTo: string;          // C-Suite agent ID
  priority: 'critical' | 'high' | 'medium';
  okrs: OKR[];
  status: 'pending' | 'assigned' | 'in-progress' | 'completed';
  regimentTasks: RegimentTask[];
}

export interface RegimentTask {
  id: string;
  objectiveId: string;
  title: string;
  description: string;
  assignedToColonel: string;   // Colonel agent ID
  assignedToRegiment: string;
  status: 'pending' | 'in-progress' | 'completed' | 'blocked';
  createdAt: string;
  completedAt?: string;
  output?: string;
}

export interface ProgramRecord {
  id: string;
  visionId: string;
  title: string;
  status: 'planning' | 'active' | 'at-risk' | 'completed';
  ownerAgentId: string;
  involvedRegiments: string[];
  dependencies: { from: string; to: string; description: string }[];
  risks: { id: string; description: string; severity: 'high' | 'medium' | 'low'; mitigation: string }[];
  timeline: { milestone: string; targetDate: string; status: 'pending' | 'on-track' | 'delayed' | 'done' }[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const visionStatements = new Map<string, VisionStatement>();
const programRecords = new Map<string, ProgramRecord>();
let persistentStore: Store | null = null;

const VISION_TABLE = 'vision_statements';
const PROGRAM_TABLE = 'program_records';

export async function initVisionStore(store: Store): Promise<void> {
  persistentStore = store;
  try {
    const storedVisions = await readAll(store, VISION_TABLE);
    for (const row of storedVisions) {
      const v = (typeof row.data === 'string' ? JSON.parse(row.data) : row) as VisionStatement;
      if (v.id) visionStatements.set(v.id, v);
    }
    const storedPrograms = await readAll(store, PROGRAM_TABLE);
    for (const row of storedPrograms) {
      const p = (typeof row.data === 'string' ? JSON.parse(row.data) : row) as ProgramRecord;
      if (p.id) programRecords.set(p.id, p);
    }
  } catch {
    // Tables may not exist yet — that's fine
  }
}

async function persistVision(v: VisionStatement): Promise<void> {
  if (!persistentStore) return;
  try { persistentStore.insert(VISION_TABLE, v.id, { data: JSON.stringify(v) }); } catch { /* ignore */ }
}

async function persistProgram(p: ProgramRecord): Promise<void> {
  if (!persistentStore) return;
  try { persistentStore.insert(PROGRAM_TABLE, p.id, { data: JSON.stringify(p) }); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Vision CRUD
// ---------------------------------------------------------------------------

export async function createVision(statement: string, createdBy: string): Promise<VisionStatement> {
  const id = `vision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const vision: VisionStatement = {
    id,
    statement,
    createdBy,
    createdAt: new Date().toISOString(),
    status: 'draft',
    programs: [],
  };
  visionStatements.set(id, vision);
  await persistVision(vision);
  return vision;
}

export function getVision(id: string): VisionStatement | undefined {
  return visionStatements.get(id);
}

export function listVisions(): VisionStatement[] {
  return [...visionStatements.values()].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// ---------------------------------------------------------------------------
// Vision Decomposition — CEO breaks vision into strategic objectives
// ---------------------------------------------------------------------------

export async function decomposeVision(visionId: string): Promise<VisionDecomposition> {
  const vision = visionStatements.get(visionId);
  if (!vision) throw new Error(`Vision ${visionId} not found`);

  const ceo = getAgentIdentity('ceo');
  if (!ceo) throw new Error('CEO agent not found in registry');

  const csuiteOfficers = getCSuiteAgents().filter(a => a.id !== 'ceo' && a.id !== 'pmo-director');

  vision.status = 'decomposing';

  // CEO decomposes the vision into strategic objectives
  const llmResponse: LLMResponse = await callLLMProvider({
    systemPrompt: ceo.systemPrompt,
    userPrompt: `You are decomposing the following organizational vision into strategic objectives for your C-Suite team.

VISION: "${vision.statement}"

Your C-Suite officers are:
${csuiteOfficers.map(o => `- ${o.callSign} (${o.role}, ID: ${o.id}) — commands the ${getCSuiteProfile(o.id)?.commandsRegiment ?? 'unknown'} regiment`).join('\n')}

Decompose this vision into 3-6 strategic objectives. For each objective:
1. Give it a clear, measurable title
2. Describe what success looks like
3. Assign it to the most relevant C-Suite officer (by their ID)
4. Set priority: critical, high, or medium
5. Define 2-3 key results with specific targets

Respond in this exact JSON format (no markdown, no code blocks):
{
  "rationale": "Why this decomposition approach works...",
  "objectives": [
    {
      "title": "Objective title",
      "description": "What success looks like",
      "assignedTo": "cmo",
      "priority": "high",
      "keyResults": [
        { "description": "Key result description", "target": "Specific target" }
      ]
    }
  ]
}`,
    provider: ceo.preferredModel as any,
  });

  // Parse the CEO's decomposition
  let parsed: { rationale: string; objectives: Array<{ title: string; description: string; assignedTo: string; priority: string; keyResults: Array<{ description: string; target: string }> }> };
  try {
    const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? llmResponse.content);
  } catch {
    // Fallback: create one objective per C-Suite officer
    parsed = {
      rationale: 'Auto-decomposed across C-Suite officers based on their domains.',
      objectives: csuiteOfficers.map(o => ({
        title: `${o.role} contribution to: ${vision.statement.slice(0, 80)}`,
        description: `${o.callSign} will lead their regiment's contribution to the organizational vision.`,
        assignedTo: o.id,
        priority: 'high',
        keyResults: [
          { description: 'Deliver regiment-level OKRs on time', target: '>85% completion' },
          { description: 'Quality score across regiment', target: '>8.0' },
        ],
      })),
    };
  }

  const decomposition: VisionDecomposition = {
    visionId,
    decomposedBy: 'ceo',
    decomposedAt: new Date().toISOString(),
    rationale: parsed.rationale,
    strategicObjectives: parsed.objectives.map((obj, i) => ({
      id: `so-${visionId}-${i + 1}`,
      title: obj.title,
      description: obj.description,
      assignedTo: obj.assignedTo,
      priority: (obj.priority as 'critical' | 'high' | 'medium') || 'high',
      status: 'assigned' as const,
      okrs: obj.keyResults.map((kr, j) => ({
        id: `okr-${visionId}-${i + 1}-${j + 1}`,
        objective: obj.title,
        owner: obj.assignedTo,
        quarter: `Q1-2026`,
        status: 'on-track' as const,
        keyResults: [{
          id: `kr-${visionId}-${i + 1}-${j + 1}`,
          description: kr.description,
          target: kr.target,
          current: '0%',
          progress: 0,
        }],
      })),
      regimentTasks: [],
    })),
  };

  vision.decomposition = decomposition;
  vision.status = 'active';
  await persistVision(vision);
  return decomposition;
}

// ---------------------------------------------------------------------------
// OKR Cascade — C-Suite officers cascade objectives to regiment Colonels
// ---------------------------------------------------------------------------

export async function cascadeToRegiment(visionId: string, objectiveId: string): Promise<RegimentTask[]> {
  const vision = visionStatements.get(visionId);
  if (!vision?.decomposition) throw new Error('Vision not decomposed yet');

  const objective = vision.decomposition.strategicObjectives.find(o => o.id === objectiveId);
  if (!objective) throw new Error(`Objective ${objectiveId} not found`);

  const csuiteAgent = getAgentIdentity(objective.assignedTo);
  if (!csuiteAgent) throw new Error(`C-Suite agent ${objective.assignedTo} not found`);

  const profile = getCSuiteProfile(objective.assignedTo);
  const colonels = getDirectReports(objective.assignedTo);

  if (colonels.length === 0) {
    // This officer might report through c-level (Olympus) first
    const olympus = getAgentIdentity('c-level');
    if (olympus) {
      colonels.push(...getDirectReports('c-level'));
    }
  }

  // C-Suite officer cascades the objective into regiment tasks
  const llmResponse: LLMResponse = await callLLMProvider({
    systemPrompt: csuiteAgent.systemPrompt,
    userPrompt: `You are cascading the following strategic objective into actionable regiment tasks.

OBJECTIVE: "${objective.title}"
DESCRIPTION: ${objective.description}
PRIORITY: ${objective.priority}

Your regiment Colonel(s):
${colonels.map(c => `- ${c.callSign} (${c.role}, ID: ${c.id}, Regiment: ${c.regiment})`).join('\n')}

Your mission: ${profile?.missionStatement ?? 'Drive excellence in your domain.'}

Break this objective into 2-5 concrete, actionable tasks that your Colonel(s) can decompose further and assign to their Captains. For each task:
1. Give a clear, action-oriented title
2. Describe what needs to happen specifically
3. Assign to the most relevant Colonel (by their ID)

Respond in this exact JSON format (no markdown, no code blocks):
{
  "tasks": [
    {
      "title": "Task title",
      "description": "What needs to happen",
      "assignedToColonel": "marketing-director"
    }
  ]
}`,
    provider: csuiteAgent.preferredModel as any,
  });

  let parsedTasks: Array<{ title: string; description: string; assignedToColonel: string }>;
  try {
    const jsonMatch = llmResponse.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] ?? llmResponse.content);
    parsedTasks = parsed.tasks;
  } catch {
    // Fallback: one task per colonel
    parsedTasks = colonels.map(c => ({
      title: `${c.callSign}: Execute ${objective.title}`,
      description: `${c.role} contribution to objective: ${objective.description}`,
      assignedToColonel: c.id,
    }));
  }

  const tasks: RegimentTask[] = parsedTasks.map((t, i) => {
    const colonel = getAgentIdentity(t.assignedToColonel);
    return {
      id: `task-${objectiveId}-${i + 1}`,
      objectiveId,
      title: t.title,
      description: t.description,
      assignedToColonel: t.assignedToColonel,
      assignedToRegiment: colonel?.regiment ?? 'Unknown',
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    };
  });

  objective.regimentTasks = tasks;
  objective.status = 'in-progress';
  await persistVision(vision);
  return tasks;
}

// ---------------------------------------------------------------------------
// PMO — Program Management Office
// ---------------------------------------------------------------------------

export async function createProgram(
  visionId: string,
  title: string,
  involvedRegiments: string[],
): Promise<ProgramRecord> {
  const id = `prog-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const program: ProgramRecord = {
    id,
    visionId,
    title,
    status: 'planning',
    ownerAgentId: 'pmo-director',
    involvedRegiments,
    dependencies: [],
    risks: [],
    timeline: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  programRecords.set(id, program);

  const vision = visionStatements.get(visionId);
  if (vision) {
    vision.programs.push(program);
    await persistVision(vision);
  }

  await persistProgram(program);
  return program;
}

export function getProgram(id: string): ProgramRecord | undefined {
  return programRecords.get(id);
}

export function listPrograms(visionId?: string): ProgramRecord[] {
  const all = [...programRecords.values()];
  if (visionId) return all.filter(p => p.visionId === visionId);
  return all.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function updateProgram(id: string, updates: Partial<Pick<ProgramRecord, 'status' | 'dependencies' | 'risks' | 'timeline'>>): Promise<ProgramRecord> {
  const program = programRecords.get(id);
  if (!program) throw new Error(`Program ${id} not found`);

  if (updates.status) program.status = updates.status;
  if (updates.dependencies) program.dependencies = updates.dependencies;
  if (updates.risks) program.risks = updates.risks;
  if (updates.timeline) program.timeline = updates.timeline;
  program.updatedAt = new Date().toISOString();

  await persistProgram(program);
  return program;
}

// ---------------------------------------------------------------------------
// PMO Status Report — Mnemosyne generates cross-functional status
// ---------------------------------------------------------------------------

export async function generatePMOStatusReport(visionId?: string): Promise<{
  generatedAt: string;
  generatedBy: string;
  activeVisions: number;
  activePrograms: number;
  regimentStatus: Record<string, { tasks: number; completed: number; blocked: number }>;
  risks: ProgramRecord['risks'];
  escalations: string[];
  summary: string;
}> {
  const visions = visionId ? [visionStatements.get(visionId)].filter(Boolean) as VisionStatement[] : listVisions().filter(v => v.status === 'active');
  const programs = visionId ? listPrograms(visionId) : listPrograms();

  const regimentStatus: Record<string, { tasks: number; completed: number; blocked: number }> = {};
  const allRisks: ProgramRecord['risks'] = [];
  const escalations: string[] = [];

  for (const vision of visions) {
    if (!vision.decomposition) continue;
    for (const obj of vision.decomposition.strategicObjectives) {
      for (const task of obj.regimentTasks) {
        const reg = task.assignedToRegiment;
        if (!regimentStatus[reg]) regimentStatus[reg] = { tasks: 0, completed: 0, blocked: 0 };
        regimentStatus[reg].tasks++;
        if (task.status === 'completed') regimentStatus[reg].completed++;
        if (task.status === 'blocked') {
          regimentStatus[reg].blocked++;
          escalations.push(`BLOCKED: "${task.title}" in ${reg} regiment`);
        }
      }
    }
  }

  for (const p of programs) {
    allRisks.push(...p.risks.filter(r => r.severity === 'high'));
  }

  // Generate summary using PMO agent
  const pmo = getAgentIdentity('pmo-director');
  let summary = 'PMO status report generated.';
  if (pmo) {
    try {
      const llmResponse = await callLLMProvider({
        systemPrompt: pmo.systemPrompt,
        userPrompt: `Generate a concise PMO status summary. Active visions: ${visions.length}. Active programs: ${programs.length}. Regiment status: ${JSON.stringify(regimentStatus)}. High risks: ${allRisks.length}. Escalations: ${escalations.length}. Provide a 2-3 sentence executive summary.`,
      });
      summary = llmResponse.content;
    } catch {
      summary = `${visions.length} active vision(s), ${programs.length} program(s). ${escalations.length} escalation(s) pending.`;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    generatedBy: 'pmo-director',
    activeVisions: visions.length,
    activePrograms: programs.length,
    regimentStatus,
    risks: allRisks,
    escalations,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Vision Status — Roll-up view from execution to vision
// ---------------------------------------------------------------------------

export function getVisionStatus(visionId: string): {
  vision: VisionStatement;
  objectiveCount: number;
  taskCount: number;
  completedTasks: number;
  blockedTasks: number;
  progress: number;
  byOfficer: Record<string, { objectives: number; tasks: number; completed: number; status: string }>;
} | undefined {
  const vision = visionStatements.get(visionId);
  if (!vision) return undefined;

  let objectiveCount = 0;
  let taskCount = 0;
  let completedTasks = 0;
  let blockedTasks = 0;
  const byOfficer: Record<string, { objectives: number; tasks: number; completed: number; status: string }> = {};

  if (vision.decomposition) {
    objectiveCount = vision.decomposition.strategicObjectives.length;
    for (const obj of vision.decomposition.strategicObjectives) {
      const officer = obj.assignedTo;
      if (!byOfficer[officer]) byOfficer[officer] = { objectives: 0, tasks: 0, completed: 0, status: 'on-track' };
      byOfficer[officer].objectives++;

      for (const task of obj.regimentTasks) {
        taskCount++;
        byOfficer[officer].tasks++;
        if (task.status === 'completed') {
          completedTasks++;
          byOfficer[officer].completed++;
        }
        if (task.status === 'blocked') blockedTasks++;
      }

      // Determine officer status
      if (byOfficer[officer].tasks > 0) {
        const completionRate = byOfficer[officer].completed / byOfficer[officer].tasks;
        byOfficer[officer].status = completionRate >= 0.8 ? 'on-track' : completionRate >= 0.5 ? 'at-risk' : 'behind';
      }
    }
  }

  const progress = taskCount > 0 ? Math.round((completedTasks / taskCount) * 100) : 0;

  return { vision, objectiveCount, taskCount, completedTasks, blockedTasks, progress, byOfficer };
}
