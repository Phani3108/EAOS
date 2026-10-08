/**
 * Program Management Persona — Skill Catalog
 * 8 skills for initiative planning, status synthesis, RAID, launch readiness.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { UnifiedSkillDef as ProgramSkillDef } from '@agentos/skills/schema';

export const PROGRAM_SKILLS: ProgramSkillDef[] = [
  {
    id: 'pgm-001', slug: 'weekly-status-synthesis', name: 'Weekly Status Synthesis',
    description: 'Aggregate updates from Jira, Confluence, and Slack into a concise executive status report with risks, blockers, and progress metrics.',
    icon: '📊', persona: 'program', executableType: 'skill', cluster: 'Reporting', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [
      { id: 'program_name', label: 'Program Name', type: 'text', required: true, section: 'basic' },
      { id: 'jira_project', label: 'Jira Project Key', type: 'text', required: true, placeholder: 'e.g. PLAT, ENG', section: 'basic' },
      { id: 'reporting_period', label: 'Reporting Period', type: 'select', required: true, options: ['This Week', 'Last Week', 'Last 2 Weeks', 'This Sprint'], section: 'basic' },
      { id: 'audience', label: 'Audience', type: 'select', required: true, options: ['Executive', 'Engineering', 'Cross-Functional', 'Board'], section: 'basic' },
      { id: 'additional_context', label: 'Additional Context', type: 'textarea', placeholder: 'Paste any manual updates, notes from 1:1s, etc.', section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-001-s1', order: 1, name: 'Gather Jira Sprint Data', agent: 'Status Analyst', tool: 'Jira', outputKey: 'jira_data' },
      { id: 'pgm-001-s2', order: 2, name: 'Scan Confluence Updates', agent: 'Status Analyst', tool: 'Confluence', outputKey: 'confluence_updates' },
      { id: 'pgm-001-s3', order: 3, name: 'Identify Risks & Blockers', agent: 'Risk Analyst', tool: 'Claude', outputKey: 'risk_assessment' },
      { id: 'pgm-001-s4', order: 4, name: 'Generate Executive Summary', agent: 'Status Analyst', tool: 'Claude', outputKey: 'exec_summary' },
      { id: 'pgm-001-s5', order: 5, name: 'Compile Status Report', agent: 'Report Compiler', tool: 'Claude', outputKey: 'status_report', requiresApproval: true },
    ],
    outputs: ['jira_data', 'confluence_updates', 'risk_assessment', 'exec_summary', 'status_report'],
    requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence', 'Slack'],
    tags: ['status', 'reporting', 'executive', 'weekly'],
  },
  {
    id: 'pgm-002', slug: 'raid-detection', name: 'RAID Log Generator',
    description: 'Scan active programs to detect and categorize Risks, Assumptions, Issues, and Dependencies with severity and mitigation recommendations.',
    icon: '⚠️', persona: 'program', executableType: 'skill', cluster: 'Risk Management', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [
      { id: 'program_name', label: 'Program Name', type: 'text', required: true, section: 'basic' },
      { id: 'program_context', label: 'Program Context', type: 'textarea', required: true, placeholder: 'Describe the program scope, timeline, stakeholders, and current state', section: 'basic' },
      { id: 'known_risks', label: 'Known Risks', type: 'textarea', placeholder: 'List any already-identified risks', section: 'advanced' },
      { id: 'dependency_teams', label: 'Dependent Teams', type: 'textarea', placeholder: 'List teams this program depends on', section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-002-s1', order: 1, name: 'Analyze Program Context', agent: 'RAID Analyst', tool: 'Claude', outputKey: 'context_analysis' },
      { id: 'pgm-002-s2', order: 2, name: 'Identify Risks', agent: 'RAID Analyst', tool: 'Claude', outputKey: 'risks' },
      { id: 'pgm-002-s3', order: 3, name: 'Map Dependencies', agent: 'Dependency Mapper', tool: 'Claude', outputKey: 'dependencies' },
      { id: 'pgm-002-s4', order: 4, name: 'Detect Issues & Assumptions', agent: 'RAID Analyst', tool: 'Claude', outputKey: 'issues_assumptions' },
      { id: 'pgm-002-s5', order: 5, name: 'Generate RAID Log with Mitigations', agent: 'RAID Analyst', tool: 'Claude', outputKey: 'raid_log', requiresApproval: true },
    ],
    outputs: ['context_analysis', 'risks', 'dependencies', 'issues_assumptions', 'raid_log'],
    requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'],
    tags: ['raid', 'risk', 'dependency', 'mitigation'],
  },
  {
    id: 'pgm-003', slug: 'launch-readiness', name: 'Launch Readiness Assessment',
    description: 'Multi-function readiness check for product launches — Engineering, Product, Marketing, Support, and Program all assessed.',
    icon: '🚀', persona: 'program', executableType: 'skill', cluster: 'Launch', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [
      { id: 'launch_name', label: 'Launch Name', type: 'text', required: true, section: 'basic' },
      { id: 'launch_date', label: 'Target Launch Date', type: 'text', required: true, placeholder: 'YYYY-MM-DD', section: 'basic' },
      { id: 'launch_scope', label: 'Launch Scope', type: 'textarea', required: true, placeholder: 'What is being launched? Features, services, changes...', section: 'basic' },
      { id: 'checklist_areas', label: 'Readiness Areas', type: 'multiselect', required: true, options: ['Engineering', 'Product', 'Marketing', 'Support', 'Legal', 'Security', 'Data'], section: 'basic' },
    ],
    steps: [
      { id: 'pgm-003-s1', order: 1, name: 'Engineering Readiness Check', agent: 'Launch Coordinator', tool: 'Claude', outputKey: 'eng_readiness' },
      { id: 'pgm-003-s2', order: 2, name: 'Product Readiness Check', agent: 'Launch Coordinator', tool: 'Claude', outputKey: 'product_readiness' },
      { id: 'pgm-003-s3', order: 3, name: 'Marketing & Comms Readiness', agent: 'Launch Coordinator', tool: 'Claude', outputKey: 'marketing_readiness' },
      { id: 'pgm-003-s4', order: 4, name: 'Support & Enablement Readiness', agent: 'Launch Coordinator', tool: 'Claude', outputKey: 'support_readiness' },
      { id: 'pgm-003-s5', order: 5, name: 'Generate Go/No-Go Recommendation', agent: 'Program Lead', tool: 'Claude', outputKey: 'go_nogo', requiresApproval: true },
    ],
    outputs: ['eng_readiness', 'product_readiness', 'marketing_readiness', 'support_readiness', 'go_nogo'],
    requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'],
    tags: ['launch', 'readiness', 'go-nogo', 'checklist'],
  },
  {
    id: 'pgm-004', slug: 'program-plan', name: 'Program Plan Generator',
    description: 'Generate a structured program plan with milestones, workstreams, RACI, and governance cadence from an initiative brief.',
    icon: '📋', persona: 'program', executableType: 'skill', cluster: 'Planning', complexity: 'complex', estimatedTime: '60–90s',
    inputs: [
      { id: 'initiative_name', label: 'Initiative Name', type: 'text', required: true, section: 'basic' },
      { id: 'initiative_brief', label: 'Initiative Brief', type: 'textarea', required: true, placeholder: 'Describe the initiative, goals, scope, and constraints', section: 'basic' },
      { id: 'timeline', label: 'Timeline', type: 'select', required: true, options: ['2 weeks', '1 month', '2 months', '1 quarter', '2 quarters'], section: 'basic' },
      { id: 'teams_involved', label: 'Teams Involved', type: 'multiselect', options: ['Engineering', 'Product', 'Marketing', 'HR', 'Finance', 'Legal', 'Sales', 'Design'], section: 'basic' },
      { id: 'constraints', label: 'Constraints', type: 'textarea', placeholder: 'Budget, headcount, technical constraints...', section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-004-s1', order: 1, name: 'Analyze Initiative Scope', agent: 'Program Planner', tool: 'Claude', outputKey: 'scope_analysis' },
      { id: 'pgm-004-s2', order: 2, name: 'Define Workstreams & Milestones', agent: 'Program Planner', tool: 'Claude', outputKey: 'workstreams' },
      { id: 'pgm-004-s3', order: 3, name: 'Build RACI Matrix', agent: 'Program Planner', tool: 'Claude', outputKey: 'raci' },
      { id: 'pgm-004-s4', order: 4, name: 'Set Governance Cadence', agent: 'Program Planner', tool: 'Claude', outputKey: 'governance' },
      { id: 'pgm-004-s5', order: 5, name: 'Compile Program Plan', agent: 'Program Lead', tool: 'Claude', outputKey: 'program_plan', requiresApproval: true },
    ],
    outputs: ['scope_analysis', 'workstreams', 'raci', 'governance', 'program_plan'],
    requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'],
    tags: ['program-plan', 'milestones', 'raci', 'governance'],
  },
  {
    id: 'pgm-005', slug: 'stakeholder-update', name: 'Stakeholder Communication Draft',
    description: 'Draft stakeholder communications — weekly updates, escalation notices, launch announcements, or risk advisories.',
    icon: '📨', persona: 'program', executableType: 'skill', cluster: 'Communication', complexity: 'simple', estimatedTime: '15–30s',
    inputs: [
      { id: 'communication_type', label: 'Type', type: 'select', required: true, options: ['Weekly Update', 'Escalation Notice', 'Launch Announcement', 'Risk Advisory', 'Milestone Completion'], section: 'basic' },
      { id: 'audience', label: 'Audience', type: 'select', required: true, options: ['Leadership', 'Engineering', 'Cross-Functional', 'External Partners', 'All Hands'], section: 'basic' },
      { id: 'context', label: 'Key Points', type: 'textarea', required: true, placeholder: 'What needs to be communicated? Key points, decisions, actions...', section: 'basic' },
      { id: 'tone', label: 'Tone', type: 'select', options: ['Executive Brief', 'Detailed Technical', 'Urgent/Critical', 'Celebratory'], section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-005-s1', order: 1, name: 'Draft Communication', agent: 'Comms Specialist', tool: 'Claude', outputKey: 'draft' },
      { id: 'pgm-005-s2', order: 2, name: 'Tone & Audience Review', agent: 'Comms Specialist', tool: 'Claude', outputKey: 'review' },
      { id: 'pgm-005-s3', order: 3, name: 'Finalize Message', agent: 'Comms Specialist', tool: 'Claude', outputKey: 'final_message', requiresApproval: true },
    ],
    outputs: ['draft', 'review', 'final_message'],
    requiredTools: ['Claude'], optionalTools: ['Slack'],
    tags: ['communication', 'stakeholder', 'update', 'announcement'],
  },
  {
    id: 'pgm-006', slug: 'dependency-mapper', name: 'Dependency Mapper',
    description: 'Map cross-team dependencies for a program — identify critical paths, blockers, and coordination points.',
    icon: '🔗', persona: 'program', executableType: 'skill', cluster: 'Risk Management', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [
      { id: 'program_name', label: 'Program Name', type: 'text', required: true, section: 'basic' },
      { id: 'workstreams', label: 'Workstreams', type: 'textarea', required: true, placeholder: 'List all workstreams and their owners', section: 'basic' },
      { id: 'known_deps', label: 'Known Dependencies', type: 'textarea', placeholder: 'List any already-known dependencies', section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-006-s1', order: 1, name: 'Analyze Workstream Relationships', agent: 'Dependency Analyst', tool: 'Claude', outputKey: 'relationship_map' },
      { id: 'pgm-006-s2', order: 2, name: 'Identify Critical Path', agent: 'Dependency Analyst', tool: 'Claude', outputKey: 'critical_path' },
      { id: 'pgm-006-s3', order: 3, name: 'Generate Dependency Matrix', agent: 'Dependency Analyst', tool: 'Claude', outputKey: 'dependency_matrix' },
    ],
    outputs: ['relationship_map', 'critical_path', 'dependency_matrix'],
    requiredTools: ['Claude'], optionalTools: ['Jira'],
    tags: ['dependency', 'critical-path', 'coordination'],
  },
  {
    id: 'pgm-007', slug: 'retrospective-facilitator', name: 'Retrospective Facilitator',
    description: 'Facilitate a structured retrospective — gather inputs, identify themes, generate actionable improvement items.',
    icon: '🔄', persona: 'program', executableType: 'skill', cluster: 'Improvement', complexity: 'moderate', estimatedTime: '30–60s',
    inputs: [
      { id: 'sprint_name', label: 'Sprint/Program Name', type: 'text', required: true, section: 'basic' },
      { id: 'what_went_well', label: 'What Went Well', type: 'textarea', required: true, placeholder: 'Paste team inputs or notes', section: 'basic' },
      { id: 'what_to_improve', label: 'What To Improve', type: 'textarea', required: true, section: 'basic' },
      { id: 'action_items_prev', label: 'Previous Action Items', type: 'textarea', placeholder: 'What were the action items from last retro?', section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-007-s1', order: 1, name: 'Analyze Themes', agent: 'Retro Facilitator', tool: 'Claude', outputKey: 'themes' },
      { id: 'pgm-007-s2', order: 2, name: 'Generate Improvement Actions', agent: 'Retro Facilitator', tool: 'Claude', outputKey: 'improvements' },
      { id: 'pgm-007-s3', order: 3, name: 'Compile Retro Summary', agent: 'Retro Facilitator', tool: 'Claude', outputKey: 'retro_summary' },
    ],
    outputs: ['themes', 'improvements', 'retro_summary'],
    requiredTools: ['Claude'], optionalTools: [],
    tags: ['retrospective', 'improvement', 'agile'],
  },
  {
    id: 'pgm-008', slug: 'executive-review-pack', name: 'Executive Review Pack',
    description: 'Generate a comprehensive executive review pack with program health, financials, risks, and decisions needed.',
    icon: '💼', persona: 'program', executableType: 'skill', cluster: 'Reporting', complexity: 'complex', estimatedTime: '60–120s',
    inputs: [
      { id: 'program_name', label: 'Program Name', type: 'text', required: true, section: 'basic' },
      { id: 'program_data', label: 'Program Data', type: 'textarea', required: true, placeholder: 'Paste status updates, metrics, financials, risk log...', section: 'basic' },
      { id: 'decisions_needed', label: 'Decisions Needed', type: 'textarea', placeholder: 'What decisions need executive input?', section: 'basic' },
      { id: 'format', label: 'Format', type: 'select', options: ['Slide Deck Summary', 'Document', 'Dashboard View'], section: 'advanced' },
    ],
    steps: [
      { id: 'pgm-008-s1', order: 1, name: 'Analyze Program Health', agent: 'Executive Analyst', tool: 'Claude', outputKey: 'health_analysis' },
      { id: 'pgm-008-s2', order: 2, name: 'Financial & Resource Summary', agent: 'Executive Analyst', tool: 'Claude', outputKey: 'financials' },
      { id: 'pgm-008-s3', order: 3, name: 'Risk & Decision Brief', agent: 'Executive Analyst', tool: 'Claude', outputKey: 'risk_decisions' },
      { id: 'pgm-008-s4', order: 4, name: 'Compile Executive Pack', agent: 'Executive Analyst', tool: 'Claude', outputKey: 'exec_pack', requiresApproval: true },
    ],
    outputs: ['health_analysis', 'financials', 'risk_decisions', 'exec_pack'],
    requiredTools: ['Claude'], optionalTools: ['Jira', 'Confluence'],
    tags: ['executive', 'review', 'pack', 'program-health'],
  },
];

export function getProgramSkill(idOrSlug: string): ProgramSkillDef | undefined {
  return PROGRAM_SKILLS.find(s => s.id === idOrSlug || s.slug === idOrSlug);
}

export function getProgramSkillsByCluster(cluster?: string): ProgramSkillDef[] {
  return cluster ? PROGRAM_SKILLS.filter(s => s.cluster === cluster) : PROGRAM_SKILLS;
}
