/**
 * Engineering Persona — Skill Catalog
 * 10 seed skills for software engineering teams.
 * All use the same AgentOS execution runtime as Marketing.
 * Uses UnifiedSkillDef from @agentos/skills for cross-persona consistency.
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import type { UnifiedSkillDef, UnifiedStepDef, UnifiedInputField } from '@agentos/skills/schema';

// Re-export for backward compat
type PersonaSkillDef = UnifiedSkillDef;
type SkillStep = UnifiedStepDef;
type SkillInputField = UnifiedInputField;
export type { PersonaSkillDef, SkillStep, SkillInputField };

export const ENGINEERING_SKILLS: UnifiedSkillDef[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // 1) PR Review Assistant
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'eng-001',
    slug: 'pr-review-assistant',
    name: 'PR Review Assistant',
    description: 'Review a pull request for correctness, maintainability, security, and performance. Generates structured feedback with risk findings and inline suggestions.',
    icon: '🔍',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Code Quality',
    complexity: 'moderate',
    estimatedTime: '45–90s',
    inputs: [
      // Basic
      { id: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'org/repo-name', section: 'basic', helpText: 'GitHub repo path or paste URL. Connect GitHub in Integrations to browse repos.' },
      { id: 'pull_request_reference', label: 'Pull Request Reference', type: 'url', required: true, placeholder: 'PR URL or PR number (e.g. 123)', section: 'basic', helpText: 'Full PR URL or numeric PR ID.' },
      { id: 'review_focus', label: 'Review Focus', type: 'multiselect', required: true, options: ['Correctness', 'Security', 'Performance', 'Maintainability', 'Readability', 'Architecture'], section: 'basic' },
      { id: 'output_style', label: 'Output Style', type: 'select', required: true, options: ['Reviewer Summary', 'Detailed Findings', 'Executive Summary', 'Inline Comment Suggestions'], section: 'basic' },
      // Advanced
      { id: 'target_branch', label: 'Target Branch', type: 'text', placeholder: 'e.g. main', section: 'advanced' },
      { id: 'coding_guidelines_text', label: 'Coding Guidelines', type: 'textarea', placeholder: 'Paste internal coding or review standards here', section: 'advanced' },
      { id: 'severity_threshold', label: 'Severity Threshold', type: 'select', options: ['All findings', 'Medium and above', 'High only'], section: 'advanced' },
      { id: 'include_suggested_fixes', label: 'Include Suggested Fixes', type: 'toggle', section: 'advanced' },
      { id: 'post_back_to_pr', label: 'Post Review Back to PR', type: 'toggle', section: 'advanced', helpText: 'Requires GitHub with write scope connected.', dependsOn: 'include_suggested_fixes' },
      // Files
      { id: 'file_attachments', label: 'Attach Files (diff, arch notes, standards)', type: 'file', multiple: true, accept: '.txt,.md,.ts,.js,.py,.go,.java,.diff,.pdf', section: 'advanced' },
    ],
    steps: [
      { id: 'eng-001-s1', order: 1, name: 'Validate PR Reference & Fetch Metadata', agent: 'Code Reviewer', tool: 'GitHub', outputKey: 'pr_metadata', capability: 'scm.read_pull_request' },
      { id: 'eng-001-s2', order: 2, name: 'Fetch Changed Files & Diff', agent: 'Code Reviewer', tool: 'GitHub', outputKey: 'pr_diff', capability: 'scm.read_diff' },
      { id: 'eng-001-s3', order: 3, name: 'Analyze Correctness & Architecture', agent: 'Code Reviewer', tool: 'Claude', outputKey: 'correctness_review', capability: 'code.analyze_structure' },
      { id: 'eng-001-s4', order: 4, name: 'Security & Error Handling Scan', agent: 'Security Analyst', tool: 'Claude', outputKey: 'security_review', capability: 'code.security_scan' },
      { id: 'eng-001-s5', order: 5, name: 'Performance & Maintainability Analysis', agent: 'Performance Engineer', tool: 'Claude', outputKey: 'performance_notes', capability: 'code.performance_review' },
      { id: 'eng-001-s6', order: 6, name: 'Generate Structured Review Summary', agent: 'Code Reviewer', tool: 'Claude', outputKey: 'review_summary', capability: 'content.generate_review_summary' },
      { id: 'eng-001-s7', order: 7, name: 'Generate Inline Comment Suggestions', agent: 'Code Reviewer', tool: 'Claude', outputKey: 'inline_suggestions', requiresApproval: true, capability: 'content.generate_review_summary' },
    ],
    outputs: ['pr_metadata', 'pr_diff', 'correctness_review', 'security_review', 'performance_notes', 'review_summary', 'inline_suggestions'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub'],
    tags: ['code-review', 'pr', 'security', 'architecture', 'performance'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2) PR Summary Generator
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'eng-002',
    slug: 'pr-summary-generator',
    name: 'PR Summary Generator',
    description: 'Generate a concise, accurate PR summary for reviewers, release notes, or standup updates from a PR reference or pasted diff.',
    icon: '📝',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Code Quality',
    complexity: 'simple',
    estimatedTime: '15–30s',
    inputs: [
      // Basic
      { id: 'repo', label: 'Repository', type: 'text', required: true, placeholder: 'org/repo-name', section: 'basic' },
      { id: 'pull_request_reference', label: 'PR Reference', type: 'text', required: true, placeholder: 'PR URL or PR number', section: 'basic' },
      { id: 'summary_style', label: 'Summary Style', type: 'select', required: true, options: ['Concise', 'Reviewer Friendly', 'Release Notes', 'Stakeholder Update', 'Standup Update'], section: 'basic' },
      { id: 'audience', label: 'Audience', type: 'select', required: true, options: ['Engineers', 'QA', 'Product', 'Leadership', 'Release Managers'], section: 'basic' },
      // Advanced
      { id: 'include_risks', label: 'Include Risk Flags', type: 'toggle', section: 'advanced' },
      { id: 'include_testing_notes', label: 'Include Testing Notes', type: 'toggle', section: 'advanced' },
      { id: 'include_file_categories', label: 'Include Changed File Categories', type: 'toggle', section: 'advanced' },
      { id: 'release_version', label: 'Release Version', type: 'text', placeholder: 'e.g. v2.4.0', section: 'advanced' },
      // Files
      { id: 'file_attachments', label: 'Attach Manual Diff or Release Template', type: 'file', multiple: true, accept: '.diff,.txt,.md,.doc,.docx', section: 'advanced' },
    ],
    steps: [
      { id: 'eng-002-s1', order: 1, name: 'Fetch PR Metadata & Diff', agent: 'Doc Writer', tool: 'GitHub', outputKey: 'pr_context', capability: 'scm.read_pull_request' },
      { id: 'eng-002-s2', order: 2, name: 'Identify Change Categories', agent: 'Doc Writer', tool: 'Claude', outputKey: 'change_categories', capability: 'content.generate_summary' },
      { id: 'eng-002-s3', order: 3, name: 'Generate Summary', agent: 'Doc Writer', tool: 'Claude', outputKey: 'pr_summary', capability: 'content.generate_summary' },
      { id: 'eng-002-s4', order: 4, name: 'Generate Reviewer Checklist Summary', agent: 'QA Engineer', tool: 'Claude', outputKey: 'reviewer_checklist', capability: 'content.generate_summary' },
    ],
    outputs: ['pr_context', 'change_categories', 'pr_summary', 'reviewer_checklist'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub'],
    tags: ['pr', 'documentation', 'release-notes', 'github'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3) Unit Test Generator
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'eng-003',
    slug: 'unit-test-generator',
    name: 'Unit Test Generator',
    description: 'Generate unit tests for a file, module, or function from a repo path or pasted source. Covers happy paths, edge cases, and error conditions.',
    icon: '🧪',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Testing',
    complexity: 'moderate',
    estimatedTime: '30–60s',
    inputs: [
      // Basic
      { id: 'repo', label: 'Repository', type: 'text', required: false, placeholder: 'org/repo-name (optional if file attached)', section: 'basic' },
      { id: 'file_path', label: 'Target File Path', type: 'text', required: false, placeholder: 'src/services/auth.ts', section: 'basic', helpText: 'Required unless uploading source file directly.' },
      { id: 'function_or_class_name', label: 'Function / Class Name', type: 'text', placeholder: 'e.g. generateToken', section: 'basic' },
      { id: 'language', label: 'Language', type: 'select', required: true, options: ['Python', 'TypeScript', 'JavaScript', 'Java', 'Go', 'Other'], section: 'basic' },
      { id: 'test_framework', label: 'Test Framework', type: 'select', required: false, options: ['Pytest', 'Jest', 'Vitest', 'JUnit', 'Go test', 'Auto Detect'], section: 'basic' },
      // Advanced
      { id: 'coverage_goal', label: 'Coverage Goal', type: 'select', options: ['Smoke coverage', 'Core logic', 'High branch coverage', 'Edge-case heavy'], section: 'advanced' },
      { id: 'include_edge_cases', label: 'Include Edge Cases', type: 'toggle', section: 'advanced' },
      { id: 'include_negative_tests', label: 'Include Negative Tests', type: 'toggle', section: 'advanced' },
      { id: 'existing_test_path', label: 'Existing Test Path', type: 'text', placeholder: 'tests/auth.test.ts', section: 'advanced' },
      { id: 'create_patch_artifact', label: 'Create Patch Artifact', type: 'toggle', section: 'advanced' },
      { id: 'create_pr_draft', label: 'Create PR Draft', type: 'toggle', section: 'advanced', helpText: 'Requires GitHub with write scope connected.', dependsOn: 'create_patch_artifact' },
      // Files
      { id: 'file_attachments', label: 'Attach Source / Test Files', type: 'file', multiple: true, accept: '.ts,.js,.py,.go,.java,.rs,.txt', section: 'advanced' },
    ],
    steps: [
      { id: 'eng-003-s1', order: 1, name: 'Resolve & Fetch Source Target', agent: 'Test Engineer', tool: 'GitHub', outputKey: 'source_code', capability: 'scm.read_file' },
      { id: 'eng-003-s2', order: 2, name: 'Detect Language & Framework', agent: 'Test Engineer', tool: 'Claude', outputKey: 'language_detection', capability: 'content.generate_tests' },
      { id: 'eng-003-s3', order: 3, name: 'Analyze Logic Branches', agent: 'Test Engineer', tool: 'Claude', outputKey: 'logic_analysis', capability: 'content.generate_tests' },
      { id: 'eng-003-s4', order: 4, name: 'Generate Unit Tests', agent: 'Test Engineer', tool: 'Claude', outputKey: 'unit_tests', capability: 'content.generate_tests' },
      { id: 'eng-003-s5', order: 5, name: 'Generate Edge-Case Coverage Notes', agent: 'Test Engineer', tool: 'Claude', outputKey: 'edge_case_notes', capability: 'content.generate_tests' },
      { id: 'eng-003-s6', order: 6, name: 'Create Patch Artifact', agent: 'Test Engineer', tool: 'Claude', outputKey: 'patch_artifact', requiresApproval: true, capability: 'storage.save_file' },
    ],
    outputs: ['source_code', 'language_detection', 'logic_analysis', 'unit_tests', 'edge_case_notes', 'patch_artifact'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub'],
    tags: ['testing', 'unit-tests', 'quality', 'tdd'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4) Integration Test Generator (retained from original)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'eng-004',
    slug: 'integration-test-generator',
    name: 'Integration Test Generator',
    description: 'Generate integration tests for API endpoints, database interactions, or service-to-service calls. Includes setup, teardown, and assertion patterns.',
    icon: '🔗',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Testing',
    complexity: 'complex',
    estimatedTime: '45–90s',
    inputs: [
      { id: 'endpoint_spec', label: 'API Endpoint / Service Spec', type: 'textarea', required: true, placeholder: 'POST /api/users → creates user, sends welcome email, inserts to DB', section: 'basic' },
      { id: 'language', label: 'Language / Framework', type: 'select', required: true, options: ['TypeScript / Jest + Supertest', 'Python / pytest + requests', 'Go / testing + httptest', 'Java / Spring Test', 'Other'], section: 'basic' },
      { id: 'test_layers', label: 'What to Test', type: 'multiselect', options: ['API contract', 'DB writes', 'External service calls', 'Auth/permissions', 'Error responses', 'Rate limiting', 'Event emissions'], section: 'basic' },
      { id: 'dependencies', label: 'External Dependencies', type: 'textarea', placeholder: 'DB: PostgreSQL, Email: SendGrid, Queue: SQS...', section: 'advanced' },
      { id: 'file_attachments', label: 'Attach Route Handlers / Schema', type: 'file', multiple: true, section: 'advanced' },
    ],
    steps: [
      { id: 'eng-004-s1', order: 1, name: 'Map Integration Points', agent: 'Test Engineer', tool: 'Claude', outputKey: 'integration_map' },
      { id: 'eng-004-s2', order: 2, name: 'Design Test Scenarios', agent: 'Test Engineer', tool: 'Claude', outputKey: 'test_scenarios' },
      { id: 'eng-004-s3', order: 3, name: 'Write Integration Tests with Setup/Teardown', agent: 'Test Engineer', tool: 'Claude', outputKey: 'integration_tests' },
      { id: 'eng-004-s4', order: 4, name: 'Generate Test Data Factories', agent: 'Test Engineer', tool: 'Claude', outputKey: 'test_factories' },
    ],
    outputs: ['integration_map', 'test_scenarios', 'integration_tests', 'test_factories'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub'],
    tags: ['testing', 'integration', 'api', 'quality'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5) CI Failure Diagnosis
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'eng-005',
    slug: 'ci-failure-diagnosis',
    name: 'CI Failure Diagnosis',
    description: 'Diagnose a failed CI/CD job from logs or a build reference. Generates likely root causes, remediation checklist, and optionally creates a Jira issue.',
    icon: '🚨',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'CI/CD',
    complexity: 'moderate',
    estimatedTime: '20–45s',
    inputs: [
      // Basic
      { id: 'repo', label: 'Repository', type: 'text', required: false, placeholder: 'org/repo-name', section: 'basic' },
      { id: 'pipeline_reference', label: 'Build / Pipeline Reference', type: 'text', required: false, placeholder: 'CI URL, run ID, or build number', section: 'basic', helpText: 'Required if not pasting logs manually.' },
      { id: 'failure_logs_text', label: 'Failure Logs', type: 'textarea', required: true, placeholder: 'Paste the full error log or key failure excerpts', section: 'basic' },
      { id: 'environment', label: 'Environment', type: 'select', options: ['Dev', 'QA', 'Staging', 'Production', 'Unknown'], section: 'basic' },
      // Advanced
      { id: 'branch', label: 'Branch', type: 'text', placeholder: 'e.g. main or feature/auth', section: 'advanced' },
      { id: 'commit_sha', label: 'Commit SHA', type: 'text', placeholder: 'abc1234', section: 'advanced' },
      { id: 'priority', label: 'Priority', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'], section: 'advanced' },
      { id: 'recent_changes_context', label: 'Recent Changes Context', type: 'textarea', placeholder: 'What changed before this failure?', section: 'advanced' },
      { id: 'create_jira_issue', label: 'Create Jira Issue', type: 'toggle', section: 'advanced', helpText: 'Requires Jira connected in Integrations.' },
      // Files
      { id: 'file_attachments', label: 'Attach Log Files or Pipeline Config', type: 'file', multiple: true, accept: '.txt,.log,.yaml,.yml,.json,.png,.jpg', section: 'advanced' },
    ],
    steps: [
      { id: 'eng-005-s1', order: 1, name: 'Ingest Logs & Fetch CI Run Metadata', agent: 'CI Analyst', tool: 'Claude', outputKey: 'ingested_logs', capability: 'ci.read_logs' },
      { id: 'eng-005-s2', order: 2, name: 'Parse & Classify Failure Signature', agent: 'CI Analyst', tool: 'Claude', outputKey: 'failure_classification', capability: 'content.generate_diagnosis' },
      { id: 'eng-005-s3', order: 3, name: 'Correlate With Changed Files', agent: 'CI Analyst', tool: 'GitHub', outputKey: 'change_correlation', capability: 'scm.read_files' },
      { id: 'eng-005-s4', order: 4, name: 'Identify Root Cause & Generate Remediation', agent: 'CI Analyst', tool: 'Claude', outputKey: 'diagnosis_report', capability: 'content.generate_diagnosis' },
      { id: 'eng-005-s5', order: 5, name: 'Create Jira Issue', agent: 'CI Analyst', tool: 'Jira', outputKey: 'jira_issue_ref', requiresApproval: true, capability: 'task.create_issue' },
    ],
    outputs: ['ingested_logs', 'failure_classification', 'change_correlation', 'diagnosis_report', 'jira_issue_ref'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub', 'Jira'],
    tags: ['ci-cd', 'debugging', 'devops', 'diagnosis'],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 6) Incident RCA Draft
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: 'eng-006',
    slug: 'incident-rca-draft',
    name: 'Incident RCA Draft',
    description: 'Generate a first-pass Root Cause Analysis document from incident notes, logs, timeline, and impact. Optionally creates a Confluence draft.',
    icon: '🔥',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Incidents',
    complexity: 'moderate',
    estimatedTime: '30–60s',
    inputs: [
      // Basic
      { id: 'incident_title', label: 'Incident Title', type: 'text', required: true, placeholder: 'payments-api 503 spike — 2026-03-11 14:00 UTC', section: 'basic' },
      { id: 'incident_summary', label: 'Incident Summary', type: 'textarea', required: true, placeholder: 'What happened? Brief overview for context.', section: 'basic' },
      { id: 'timeline_text', label: 'Incident Timeline', type: 'textarea', required: true, placeholder: '14:00 — Alert fired\n14:05 — On-call paged\n14:12 — Root cause identified...', section: 'basic' },
      { id: 'severity', label: 'Severity', type: 'select', options: ['SEV-1', 'SEV-2', 'SEV-3', 'SEV-4'], section: 'basic' },
      // Advanced
      { id: 'services_impacted', label: 'Services Impacted', type: 'tags', placeholder: 'payments-api, auth-service, checkout', section: 'advanced' },
      { id: 'customer_impact', label: 'Customer Impact', type: 'textarea', placeholder: '~800 users affected, $12K revenue loss, SLA breached', section: 'advanced' },
      { id: 'incident_owner', label: 'Incident Owner', type: 'text', placeholder: 'alice@corp.com', section: 'advanced' },
      { id: 'jira_issue_id', label: 'Linked Jira Issue', type: 'text', placeholder: 'ENG-1234', section: 'advanced' },
      { id: 'create_confluence_draft', label: 'Create Confluence Draft', type: 'toggle', section: 'advanced', helpText: 'Requires Confluence connected in Integrations.' },
      { id: 'generate_corrective_actions', label: 'Generate Corrective Actions', type: 'toggle', section: 'advanced' },
      // Files
      { id: 'file_attachments', label: 'Attach Logs, Screenshots, Dashboards', type: 'file', multiple: true, accept: '.txt,.log,.png,.jpg,.pdf,.csv', section: 'advanced' },
    ],
    steps: [
      { id: 'eng-006-s1', order: 1, name: 'Normalize Event Sequence & Context', agent: 'SRE Analyst', tool: 'Claude', outputKey: 'event_sequence', capability: 'content.generate_rca' },
      { id: 'eng-006-s2', order: 2, name: 'Identify Probable Root Cause Chain', agent: 'SRE Analyst', tool: 'Claude', outputKey: 'root_cause_chain', capability: 'content.generate_rca' },
      { id: 'eng-006-s3', order: 3, name: 'Generate Impact & Contributing Factors', agent: 'SRE Analyst', tool: 'Claude', outputKey: 'impact_factors', capability: 'content.generate_rca' },
      { id: 'eng-006-s4', order: 4, name: 'Draft Full RCA Document', agent: 'SRE Analyst', tool: 'Claude', outputKey: 'rca_document', requiresApproval: true, capability: 'content.generate_rca' },
      { id: 'eng-006-s5', order: 5, name: 'Generate Corrective & Preventive Actions', agent: 'SRE Analyst', tool: 'Claude', outputKey: 'corrective_actions', capability: 'content.generate_rca' },
      { id: 'eng-006-s6', order: 6, name: 'Create Confluence Draft Page', agent: 'SRE Analyst', tool: 'Confluence', outputKey: 'confluence_draft_ref', capability: 'docs.create_page_draft' },
    ],
    outputs: ['event_sequence', 'root_cause_chain', 'impact_factors', 'rca_document', 'corrective_actions', 'confluence_draft_ref'],
    requiredTools: ['Claude'],
    optionalTools: ['Jira', 'Confluence', 'Google Drive'],
    tags: ['incident', 'rca', 'sre', 'reliability', 'postmortem'],
  },
  {
    id: 'eng-007',
    slug: 'codebase-explainer',
    name: 'Codebase Explainer',
    description: 'Analyze and explain an unfamiliar codebase, module, or function. Generates architecture summary, data flow, and onboarding guide.',
    icon: '🗺️',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Documentation',
    complexity: 'moderate',
    estimatedTime: '30–60s',
    inputs: [
      { id: 'code_or_module', label: 'Code to Explain (paste or describe)', type: 'textarea', required: true, placeholder: 'Paste code, describe module, or explain what you need to understand', section: 'basic' },
      { id: 'context', label: 'What do you know so far?', type: 'textarea', placeholder: 'This is a payments service built on Node.js. I need to understand the auth middleware.', section: 'basic' },
      { id: 'audience', label: 'Audience Level', type: 'select', options: ['New engineer (junior)', 'Mid-level engineer', 'Senior engineer', 'Non-technical stakeholder'], section: 'basic' },
      { id: 'file_attachments', label: 'Attach Source Files', type: 'file', accept: '.ts,.js,.py,.go,.java,.rs,.rb,.md', section: 'advanced' },
    ],
    steps: [
      { id: 's1', order: 1, name: 'Parse & Map Code Structure', agent: 'Code Explainer', tool: 'Claude', outputKey: 'code_map' },
      { id: 's2', order: 2, name: 'Explain Architecture & Data Flow', agent: 'Code Explainer', tool: 'Claude', outputKey: 'architecture_explanation' },
      { id: 's3', order: 3, name: 'Generate Onboarding Guide', agent: 'Doc Writer', tool: 'Claude', outputKey: 'onboarding_guide' },
    ],
    outputs: ['code_map', 'architecture_explanation', 'onboarding_guide'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub'],
    tags: ['documentation', 'onboarding', 'codebase', 'learning'],
  },
  {
    id: 'eng-008',
    slug: 'architecture-summary-generator',
    name: 'Architecture Summary Generator',
    description: 'Generate a clear architecture summary document from system diagrams, code, and descriptions. Suitable for design reviews, wikis, and onboarding.',
    icon: '🏗️',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Architecture',
    complexity: 'moderate',
    estimatedTime: '30–60s',
    inputs: [
      { id: 'system_name', label: 'System / Service Name', type: 'text', required: true, placeholder: 'Order Processing Service', section: 'basic' },
      { id: 'description', label: 'What does it do?', type: 'textarea', required: true, placeholder: 'Handles all order creation, validation, payment, and fulfillment workflows', section: 'basic' },
      { id: 'components', label: 'Key Components / Services', type: 'textarea', placeholder: 'API Gateway, Order Service, Payment Service, Inventory DB, SQS queue...', section: 'basic' },
      { id: 'tech_stack', label: 'Tech Stack', type: 'tags', placeholder: 'Node.js, PostgreSQL, Redis, SQS, Docker', section: 'basic' },
      { id: 'integrations', label: 'External Integrations', type: 'textarea', placeholder: 'Stripe, SendGrid, Warehouse API...', section: 'advanced' },
      { id: 'scale', label: 'Scale & Load', type: 'text', placeholder: 'e.g. 1M orders/day, 10K RPS peak', section: 'advanced' },
      { id: 'file_attachments', label: 'Attach Diagrams or Docs', type: 'file', accept: '.png,.jpg,.pdf,.md,.txt', section: 'advanced' },
    ],
    steps: [
      { id: 's1', order: 1, name: 'Map System Components & Boundaries', agent: 'Architect', tool: 'Claude', outputKey: 'component_map' },
      { id: 's2', order: 2, name: 'Document Data Flows & Integration Points', agent: 'Architect', tool: 'Claude', outputKey: 'data_flows' },
      { id: 's3', order: 3, name: 'Generate Architecture Summary Document', agent: 'Doc Writer', tool: 'Claude', outputKey: 'architecture_doc' },
      { id: 's4', order: 4, name: 'List Key Decisions & Trade-offs', agent: 'Architect', tool: 'Claude', outputKey: 'design_decisions' },
    ],
    outputs: ['component_map', 'data_flows', 'architecture_doc', 'design_decisions'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub', 'Confluence'],
    tags: ['architecture', 'documentation', 'design', 'systems'],
  },
  {
    id: 'eng-009',
    slug: 'technical-documentation-generator',
    name: 'Technical Documentation Generator',
    description: 'Generate comprehensive technical docs for APIs, services, or libraries. Includes overview, usage, examples, and configuration reference.',
    icon: '📖',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Documentation',
    complexity: 'moderate',
    estimatedTime: '30–60s',
    inputs: [
      { id: 'doc_subject', label: 'What to Document', type: 'text', required: true, placeholder: 'Auth Service API', section: 'basic' },
      { id: 'code_or_spec', label: 'Code, Schema, or Spec (paste)', type: 'textarea', required: true, placeholder: 'Paste OpenAPI spec, code, README stub...', section: 'basic' },
      { id: 'audience', label: 'Target Audience', type: 'select', options: ['Internal engineers', 'External developers', 'DevOps / SRE', 'Non-technical readers'], section: 'basic' },
      { id: 'doc_sections', label: 'Include Sections', type: 'multiselect', options: ['Overview', 'Getting started', 'API reference', 'Configuration', 'Examples', 'Troubleshooting', 'Changelog', 'FAQ'], section: 'basic' },
      { id: 'file_attachments', label: 'Attach Code or Existing Docs', type: 'file', section: 'advanced' },
    ],
    steps: [
      { id: 's1', order: 1, name: 'Parse Source & Identify Scope', agent: 'Doc Writer', tool: 'Claude', outputKey: 'doc_scope' },
      { id: 's2', order: 2, name: 'Write Overview & Getting Started', agent: 'Doc Writer', tool: 'Claude', outputKey: 'overview_section' },
      { id: 's3', order: 3, name: 'Generate API Reference & Examples', agent: 'Doc Writer', tool: 'Claude', outputKey: 'api_reference' },
      { id: 's4', order: 4, name: 'Write Troubleshooting & FAQ', agent: 'Doc Writer', tool: 'Claude', outputKey: 'troubleshooting' },
    ],
    outputs: ['doc_scope', 'overview_section', 'api_reference', 'troubleshooting'],
    requiredTools: ['Claude'],
    optionalTools: ['GitHub', 'Confluence'],
    tags: ['documentation', 'api', 'developer-experience'],
  },
  {
    id: 'eng-010',
    slug: 'jira-ticket-breakdown',
    name: 'Jira Ticket → Engineering Task Breakdown',
    description: 'Convert a Jira epic or story into a structured set of engineering sub-tasks with acceptance criteria, effort estimates, and technical notes.',
    icon: '📋',
    persona: 'engineering',
    executableType: 'skill',
    cluster: 'Planning',
    complexity: 'simple',
    estimatedTime: '20–40s',
    inputs: [
      { id: 'ticket_title', label: 'Epic / Story Title', type: 'text', required: true, placeholder: 'Implement OAuth2 login', section: 'basic' },
      { id: 'ticket_description', label: 'Description / Requirements', type: 'textarea', required: true, placeholder: 'Paste the Jira ticket description or user story', section: 'basic' },
      { id: 'acceptance_criteria', label: 'Acceptance Criteria (if any)', type: 'textarea', placeholder: 'User can log in with Google, tokens expire in 1h...', section: 'basic' },
      { id: 'tech_context', label: 'Technical Context', type: 'textarea', placeholder: 'We use Node.js, Passport.js is already installed, DB is PostgreSQL', section: 'basic' },
      { id: 'team_size', label: 'Team Size', type: 'select', options: ['Solo', '2 engineers', '3–5 engineers', '5+ engineers'], section: 'advanced' },
      { id: 'sprint_duration', label: 'Sprint Duration', type: 'select', options: ['1 week', '2 weeks', '3 weeks'], section: 'advanced' },
    ],
    steps: [
      { id: 's1', order: 1, name: 'Analyze Requirements & Scope', agent: 'Tech Lead', tool: 'Claude', outputKey: 'scope_analysis' },
      { id: 's2', order: 2, name: 'Break Down into Engineering Tasks', agent: 'Tech Lead', tool: 'Claude', outputKey: 'task_breakdown' },
      { id: 's3', order: 3, name: 'Add Acceptance Criteria & Estimates', agent: 'Tech Lead', tool: 'Claude', outputKey: 'acceptance_criteria' },
    ],
    outputs: ['scope_analysis', 'task_breakdown', 'acceptance_criteria'],
    requiredTools: ['Claude'],
    optionalTools: ['Jira', 'GitHub'],
    tags: ['planning', 'jira', 'estimation', 'tasks'],
  },
];

export function getEngineeringSkill(idOrSlug: string): PersonaSkillDef | undefined {
  return ENGINEERING_SKILLS.find((s) => s.id === idOrSlug || s.slug === idOrSlug);
}

export function getEngineeringSkillsByCluster(): Record<string, PersonaSkillDef[]> {
  const grouped: Record<string, PersonaSkillDef[]> = {};
  for (const skill of ENGINEERING_SKILLS) {
    if (!grouped[skill.cluster]) grouped[skill.cluster] = [];
    grouped[skill.cluster].push(skill);
  }
  return grouped;
}
