/**
 * Persona Skill System — Enterprise Operating Layer
 *
 * Users interact through personas → skills → agents → tools → workflows.
 * Each persona contains exhaustive skills, agents, tool integrations, courses.
 */

import { getFsSkills } from './skill-fs-loader.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface Persona {
  id: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  skillCategories: SkillCategory[];
  agents: AgentDef[];
  tools: ToolDef[];
  courses: Course[];
  promptExamples: string[];
}

export interface SkillCategory {
  name: string;
  skills: Skill[];
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  agents: string[];
  estimatedTime: string;
  complexity: 'simple' | 'moderate' | 'complex';
  outputs: string[];
}

export interface AgentDef {
  id: string;
  name: string;
  description: string;
  tools: string[];
  status: 'active' | 'beta' | 'coming_soon';
}

export interface ToolDef {
  id: string;
  name: string;
  icon: string;
  category: string;
  authType: 'oauth' | 'api_key' | 'mcp';
  connected: boolean;
  description: string;
}

export interface Course {
  id: string;
  title: string;
  provider: string;
  duration: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  url: string;
}

export interface LicenseRecord {
  toolId: string;
  toolName: string;
  icon: string;
  totalLicenses: number;
  usedLicenses: number;
  costPerMonth: number;
  expirationDate: string;
  usageFrequency: number;
  users: { userId: string; name: string; lastUsed: string; role: string }[];
}

// ---------------------------------------------------------------------------
// Persona Definitions
// ---------------------------------------------------------------------------

/** Exported for frontend fallback when API is unavailable */
export const PERSONAS: Persona[] = [
  // ── 1. PRODUCT ──
  {
    id: 'product', name: 'Product', icon: '📦', color: '#8b5cf6',
    description: 'Product management skills — PRDs, roadmaps, backlog management, strategy, and analytics.',
    skillCategories: [
      { name: 'Documentation', skills: [
        { id: 'product.doc.prd', name: 'Write PRD', description: 'Generate a structured Product Requirements Document from a brief.', agents: ['prd-agent', 'research-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['PRD document', 'User stories', 'Success metrics'] },
        { id: 'product.doc.brd', name: 'Write BRD', description: 'Generate a Business Requirements Document with stakeholder analysis.', agents: ['prd-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['BRD document', 'Stakeholder map'] },
        { id: 'product.doc.stories', name: 'Generate user stories', description: 'Create user stories with acceptance criteria from requirements.', agents: ['epic-generator-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['User stories', 'Acceptance criteria'] },
        { id: 'product.doc.acceptance', name: 'Create acceptance criteria', description: 'Define testable acceptance criteria for each feature.', agents: ['prd-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Acceptance criteria list'] },
        { id: 'product.doc.spec', name: 'Create product spec', description: 'Write a detailed technical product specification.', agents: ['prd-agent', 'research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Product spec', 'Technical requirements'] },
        { id: 'product.doc.release', name: 'Generate release notes', description: 'Auto-generate release notes from Jira tickets and PRs.', agents: ['prd-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Release notes'] },
        { id: 'product.doc.faq', name: 'Write product FAQ', description: 'Generate comprehensive FAQ for a product feature.', agents: ['prd-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['FAQ document'] },
        { id: 'product.doc.announce', name: 'Generate product announcement', description: 'Draft internal/external product announcement.', agents: ['prd-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Announcement draft', 'Email template'] },
      ]},
      { name: 'Planning', skills: [
        { id: 'product.plan.roadmap', name: 'Create roadmap', description: 'Generate a quarterly or yearly product roadmap.', agents: ['roadmap-agent', 'strategy-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Roadmap timeline', 'Milestones', 'Dependencies'] },
        { id: 'product.plan.prioritize', name: 'Feature prioritization', description: 'Score and rank features using RICE, ICE, or custom frameworks.', agents: ['strategy-agent', 'analytics-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Prioritized feature list', 'Scoring matrix'] },
        { id: 'product.plan.sprint', name: 'Sprint planning', description: 'Plan sprint scope based on velocity and priorities.', agents: ['roadmap-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Sprint plan', 'Capacity allocation'] },
        { id: 'product.plan.epic', name: 'Epic generation', description: 'Break down initiatives into well-structured epics.', agents: ['epic-generator-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Epic definitions', 'Story breakdown'] },
        { id: 'product.plan.milestone', name: 'Milestone planning', description: 'Define project milestones with deliverables and dates.', agents: ['roadmap-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Milestone plan'] },
        { id: 'product.plan.backlog', name: 'Backlog grooming', description: 'Refine and re-prioritize the product backlog.', agents: ['roadmap-agent', 'analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Groomed backlog', 'Priority changes'] },
      ]},
      { name: 'Research', skills: [
        { id: 'product.research.competitor', name: 'Competitor analysis', description: 'Research and compare competitor products and features.', agents: ['research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Competitor matrix', 'Feature comparison', 'Gap analysis'] },
        { id: 'product.research.market', name: 'Market research', description: 'Analyze market trends, size, and opportunity.', agents: ['research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Market report', 'Trend analysis'] },
        { id: 'product.research.interviews', name: 'Customer interview synthesis', description: 'Synthesize insights from customer interview transcripts.', agents: ['research-agent', 'analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Insight themes', 'Opportunity areas'] },
        { id: 'product.research.feedback', name: 'User feedback analysis', description: 'Analyze user feedback from surveys, reviews, and tickets.', agents: ['analytics-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Sentiment analysis', 'Top issues'] },
        { id: 'product.research.analytics', name: 'Product analytics insights', description: 'Extract insights from product usage data.', agents: ['analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Usage report', 'Funnel analysis', 'Cohort data'] },
      ]},
      { name: 'Execution', skills: [
        { id: 'product.exec.jira_epics', name: 'Create Jira epics', description: 'Generate and create epics in Jira from a PRD.', agents: ['epic-generator-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Jira epics'] },
        { id: 'product.exec.jira_tickets', name: 'Create Jira tickets', description: 'Generate granular Jira tickets with details.', agents: ['epic-generator-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Jira tickets'] },
        { id: 'product.exec.sprint_board', name: 'Create sprint board', description: 'Set up a sprint board with columns and assignments.', agents: ['roadmap-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Sprint board'] },
        { id: 'product.exec.update_backlog', name: 'Update backlog', description: 'Batch update backlog items with new priorities.', agents: ['roadmap-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Updated backlog'] },
        { id: 'product.exec.checklist', name: 'Generate release checklist', description: 'Create a pre-release checklist for launch readiness.', agents: ['prd-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Release checklist'] },
      ]},
      { name: 'Strategy', skills: [
        { id: 'product.strategy.impact', name: 'Feature impact analysis', description: 'Assess the potential impact of a feature on key metrics.', agents: ['strategy-agent', 'analytics-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Impact assessment', 'Metric projections'] },
        { id: 'product.strategy.vision', name: 'Product vision statement', description: 'Draft a compelling product vision and mission.', agents: ['strategy-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Vision statement', 'Mission statement'] },
        { id: 'product.strategy.pricing', name: 'Pricing strategy outline', description: 'Design pricing tiers and monetization models.', agents: ['strategy-agent', 'research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Pricing model', 'Tier comparison'] },
        { id: 'product.strategy.experiment', name: 'Experiment design', description: 'Design A/B tests and experiments with hypothesis.', agents: ['strategy-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Experiment plan', 'Hypothesis', 'Success criteria'] },
        { id: 'product.strategy.growth', name: 'Growth opportunity mapping', description: 'Identify and map growth levers and opportunities.', agents: ['strategy-agent', 'analytics-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Growth map', 'Opportunity matrix'] },
      ]},
    ],
    agents: [
      { id: 'prd-agent', name: 'PRD Agent', description: 'Generates structured product documents from briefs and requirements.', tools: ['confluence', 'notion', 'google-docs'], status: 'active' },
      { id: 'research-agent', name: 'Research Agent', description: 'Conducts market, competitor, and user research.', tools: ['notion', 'amplitude', 'mixpanel'], status: 'active' },
      { id: 'roadmap-agent', name: 'Roadmap Agent', description: 'Creates and manages product roadmaps and sprint plans.', tools: ['jira', 'productboard', 'miro'], status: 'active' },
      { id: 'epic-generator-agent', name: 'Epic Generator Agent', description: 'Breaks down PRDs into epics, stories, and tickets.', tools: ['jira', 'confluence'], status: 'active' },
      { id: 'analytics-agent', name: 'Product Analytics Agent', description: 'Extracts insights from product usage data.', tools: ['amplitude', 'mixpanel'], status: 'beta' },
      { id: 'strategy-agent', name: 'Strategy Agent', description: 'Assists with pricing, positioning, and growth strategy.', tools: ['notion', 'google-docs'], status: 'beta' },
    ],
    tools: [
      { id: 'jira', name: 'Jira', icon: '🔷', category: 'Project Management', authType: 'oauth', connected: true, description: 'Issue and project tracking' },
      { id: 'confluence', name: 'Confluence', icon: '📝', category: 'Documentation', authType: 'oauth', connected: true, description: 'Wiki and documentation' },
      { id: 'notion', name: 'Notion', icon: '📓', category: 'Documentation', authType: 'oauth', connected: false, description: 'All-in-one workspace' },
      { id: 'productboard', name: 'Productboard', icon: '📌', category: 'Product Management', authType: 'api_key', connected: false, description: 'Product management platform' },
      { id: 'figma', name: 'Figma', icon: '🎨', category: 'Design', authType: 'oauth', connected: true, description: 'Collaborative design tool' },
      { id: 'miro', name: 'Miro', icon: '🗂️', category: 'Collaboration', authType: 'oauth', connected: false, description: 'Online whiteboard' },
      { id: 'slack', name: 'Slack', icon: '💬', category: 'Communication', authType: 'oauth', connected: true, description: 'Team messaging' },
      { id: 'google-docs', name: 'Google Docs', icon: '📄', category: 'Documentation', authType: 'oauth', connected: true, description: 'Document collaboration' },
      { id: 'amplitude', name: 'Amplitude', icon: '📈', category: 'Analytics', authType: 'api_key', connected: false, description: 'Product analytics' },
      { id: 'mixpanel', name: 'Mixpanel', icon: '📊', category: 'Analytics', authType: 'api_key', connected: false, description: 'User analytics' },
    ],
    courses: [
      { id: 'c-prod-1', title: 'Writing great PRDs', provider: 'Internal', duration: '2h', level: 'beginner', url: '#' },
      { id: 'c-prod-2', title: 'Agile product management', provider: 'Coursera', duration: '8h', level: 'intermediate', url: '#' },
      { id: 'c-prod-3', title: 'Product discovery', provider: 'Teresa Torres', duration: '6h', level: 'intermediate', url: '#' },
      { id: 'c-prod-4', title: 'Product analytics fundamentals', provider: 'Amplitude', duration: '4h', level: 'beginner', url: '#' },
      { id: 'c-prod-5', title: 'AI for product managers', provider: 'DeepLearning.AI', duration: '5h', level: 'intermediate', url: 'https://deeplearning.ai' },
    ],
    promptExamples: [
      'Write PRD for AI customer support assistant',
      'Generate Jira epics from this PRD',
      'Create roadmap for AI copilots in banking',
      'Analyze competitor features in expense management',
      'Design pricing tiers for our SaaS platform',
    ],
  },

  // ── 2. ENGINEERING ──
  {
    id: 'engineering', name: 'Engineering', icon: '⚙️', color: '#3b82f6',
    description: 'Software engineering skills — code review, testing, DevOps, architecture, and incident response.',
    skillCategories: [
      { name: 'Code', skills: [
        { id: 'eng.code.generate', name: 'Code generation', description: 'Generate code from natural language specifications.', agents: ['code-review-agent'], estimatedTime: '~1m', complexity: 'moderate', outputs: ['Source code', 'Documentation'] },
        { id: 'eng.code.refactor', name: 'Refactor code', description: 'Suggest and apply refactoring improvements.', agents: ['code-review-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Refactored code', 'Change summary'] },
        { id: 'eng.code.explain', name: 'Explain code', description: 'Generate human-readable explanation of code.', agents: ['code-review-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Code explanation'] },
        { id: 'eng.code.optimize', name: 'Optimize code', description: 'Identify and apply performance optimizations.', agents: ['code-review-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Optimized code', 'Performance report'] },
        { id: 'eng.code.apidoc', name: 'Generate API documentation', description: 'Auto-generate API docs from code and schemas.', agents: ['code-review-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['API documentation', 'OpenAPI spec'] },
      ]},
      { name: 'PR Workflows', skills: [
        { id: 'eng.pr.review', name: 'PR review', description: 'Automated code review for security, performance, and patterns.', agents: ['code-review-agent', 'security-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Review comments', 'Score card'] },
        { id: 'eng.pr.summary', name: 'Generate PR summary', description: 'Create concise PR description from diff.', agents: ['code-review-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['PR summary'] },
        { id: 'eng.pr.fixes', name: 'Suggest fixes', description: 'Propose fixes for issues found in PR review.', agents: ['code-review-agent'], estimatedTime: '~1m', complexity: 'moderate', outputs: ['Fix suggestions', 'Code patches'] },
        { id: 'eng.pr.comments', name: 'Generate code comments', description: 'Add inline documentation to code.', agents: ['code-review-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Commented code'] },
        { id: 'eng.pr.merge', name: 'Merge recommendation', description: 'Assess readiness to merge with risk analysis.', agents: ['code-review-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Merge recommendation', 'Risk assessment'] },
      ]},
      { name: 'Testing', skills: [
        { id: 'eng.test.unit', name: 'Generate unit tests', description: 'Create unit tests for a given module or function.', agents: ['test-gen-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Unit test files', 'Coverage report'] },
        { id: 'eng.test.integration', name: 'Generate integration tests', description: 'Create integration tests for service interactions.', agents: ['test-gen-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Integration test suite'] },
        { id: 'eng.test.plan', name: 'Generate test plan', description: 'Create a comprehensive test plan for a feature.', agents: ['test-gen-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Test plan document'] },
        { id: 'eng.test.qa', name: 'Automate QA scenarios', description: 'Generate E2E test scenarios from user stories.', agents: ['test-gen-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['QA scenarios', 'E2E test scripts'] },
      ]},
      { name: 'DevOps', skills: [
        { id: 'eng.devops.ci', name: 'Generate CI pipeline', description: 'Create CI/CD pipeline configuration.', agents: ['ci-debug-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Pipeline YAML', 'Stage definitions'] },
        { id: 'eng.devops.debug_ci', name: 'Debug CI failures', description: 'Analyze and fix CI pipeline failures.', agents: ['ci-debug-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Root cause', 'Fix suggestion'] },
        { id: 'eng.devops.dockerfile', name: 'Dockerfile generation', description: 'Generate optimized Dockerfiles for services.', agents: ['ci-debug-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Dockerfile', 'Build instructions'] },
        { id: 'eng.devops.k8s', name: 'Kubernetes deployment generation', description: 'Generate K8s manifests and Helm charts.', agents: ['ci-debug-agent', 'architecture-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['K8s manifests', 'Helm chart'] },
        { id: 'eng.devops.infra', name: 'Infra troubleshooting', description: 'Diagnose infrastructure issues from logs and metrics.', agents: ['incident-rca-agent', 'ci-debug-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Diagnosis', 'Fix steps'] },
      ]},
      { name: 'Architecture', skills: [
        { id: 'eng.arch.design', name: 'System design diagrams', description: 'Generate architecture diagrams from descriptions.', agents: ['architecture-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Architecture diagram', 'Component list'] },
        { id: 'eng.arch.docs', name: 'Architecture documentation', description: 'Write architecture decision records and design docs.', agents: ['architecture-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['ADR document', 'Design doc'] },
        { id: 'eng.arch.deps', name: 'Dependency mapping', description: 'Map service dependencies and data flows.', agents: ['architecture-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Dependency graph', 'Data flow diagram'] },
        { id: 'eng.arch.topology', name: 'Service topology visualization', description: 'Visualize microservice topology and connections.', agents: ['architecture-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Topology map'] },
      ]},
      { name: 'Operations', skills: [
        { id: 'eng.ops.rca', name: 'Incident RCA', description: 'Perform root cause analysis on production incidents.', agents: ['incident-rca-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['RCA report', 'Timeline', 'Remediation plan'] },
        { id: 'eng.ops.logs', name: 'Log analysis', description: 'Analyze logs to identify errors and patterns.', agents: ['incident-rca-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Log summary', 'Error patterns'] },
        { id: 'eng.ops.perf', name: 'Performance optimization', description: 'Identify performance bottlenecks and suggest optimizations.', agents: ['code-review-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Performance report', 'Optimization steps'] },
        { id: 'eng.ops.security', name: 'Security vulnerability scan', description: 'Scan code and dependencies for security issues.', agents: ['security-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Vulnerability report', 'CVE list', 'Fix recommendations'] },
      ]},
    ],
    agents: [
      { id: 'code-review-agent', name: 'Code Review Agent', description: 'Reviews code for quality, security, and performance.', tools: ['github', 'gitlab', 'bitbucket'], status: 'active' },
      { id: 'ci-debug-agent', name: 'CI Debug Agent', description: 'Diagnoses and fixes CI/CD pipeline failures.', tools: ['github', 'jenkins', 'circleci', 'docker'], status: 'active' },
      { id: 'architecture-agent', name: 'Architecture Agent', description: 'Designs system architectures and generates diagrams.', tools: ['confluence', 'miro'], status: 'active' },
      { id: 'test-gen-agent', name: 'Test Generation Agent', description: 'Generates unit, integration, and E2E tests.', tools: ['github', 'gitlab'], status: 'active' },
      { id: 'incident-rca-agent', name: 'Incident RCA Agent', description: 'Analyzes incidents with logs, metrics, and past data.', tools: ['sentry', 'datadog', 'jira'], status: 'active' },
      { id: 'security-agent', name: 'Security Agent', description: 'Scans for vulnerabilities and enforces security policies.', tools: ['github', 'sentry'], status: 'beta' },
    ],
    tools: [
      { id: 'github', name: 'GitHub', icon: '🐙', category: 'Version Control', authType: 'oauth', connected: true, description: 'Code hosting and collaboration' },
      { id: 'gitlab', name: 'GitLab', icon: '🦊', category: 'Version Control', authType: 'oauth', connected: false, description: 'DevOps platform' },
      { id: 'bitbucket', name: 'Bitbucket', icon: '🪣', category: 'Version Control', authType: 'oauth', connected: false, description: 'Atlassian code hosting' },
      { id: 'jenkins', name: 'Jenkins', icon: '🔨', category: 'CI/CD', authType: 'api_key', connected: false, description: 'Build automation' },
      { id: 'circleci', name: 'CircleCI', icon: '⚡', category: 'CI/CD', authType: 'api_key', connected: false, description: 'Continuous integration' },
      { id: 'docker', name: 'Docker', icon: '🐳', category: 'Infrastructure', authType: 'api_key', connected: true, description: 'Container platform' },
      { id: 'kubernetes', name: 'Kubernetes', icon: '☸️', category: 'Infrastructure', authType: 'api_key', connected: true, description: 'Container orchestration' },
      { id: 'sentry', name: 'Sentry', icon: '🛡️', category: 'Monitoring', authType: 'api_key', connected: true, description: 'Error tracking' },
      { id: 'datadog', name: 'Datadog', icon: '🐕', category: 'Monitoring', authType: 'api_key', connected: true, description: 'Monitoring and analytics' },
      { id: 'jira-eng', name: 'Jira', icon: '🔷', category: 'Project Management', authType: 'oauth', connected: true, description: 'Issue tracking' },
      { id: 'confluence-eng', name: 'Confluence', icon: '📝', category: 'Documentation', authType: 'oauth', connected: true, description: 'Documentation wiki' },
    ],
    courses: [
      { id: 'c-eng-1', title: 'Advanced Git workflows', provider: 'Internal', duration: '3h', level: 'intermediate', url: '#' },
      { id: 'c-eng-2', title: 'Secure coding', provider: 'OWASP', duration: '6h', level: 'advanced', url: '#' },
      { id: 'c-eng-3', title: 'Cloud architecture', provider: 'AWS', duration: '10h', level: 'advanced', url: 'https://skillbuilder.aws' },
      { id: 'c-eng-4', title: 'Observability best practices', provider: 'Datadog', duration: '4h', level: 'intermediate', url: '#' },
      { id: 'c-eng-5', title: 'AI assisted development', provider: 'DeepLearning.AI', duration: '5h', level: 'intermediate', url: 'https://deeplearning.ai' },
    ],
    promptExamples: [
      'Review this PR for security and performance',
      'Generate unit tests for this module',
      'Explain this microservice architecture',
      'Debug the CI pipeline failure on main branch',
      'Generate a Dockerfile for our Node.js API service',
    ],
  },

  // ── 3. MARKETING ──
  {
    id: 'marketing', name: 'Marketing', icon: '📣', color: '#f59e0b',
    description: 'Marketing operations — campaigns, content creation, analytics, and optimization.',
    skillCategories: [
      { name: 'Campaign', skills: [
        { id: 'mkt.campaign.plan', name: 'Campaign planning', description: 'Design a full campaign strategy with ICP, channels, and messaging.', agents: ['campaign-agent', 'copy-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Campaign brief', 'Channel plan', 'Timeline'] },
        { id: 'mkt.campaign.launch', name: 'Campaign launch', description: 'Set up and launch campaigns across ad platforms.', agents: ['campaign-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Live campaigns', 'Tracking setup'] },
        { id: 'mkt.campaign.copy', name: 'Ad copy generation', description: 'Generate ad copy variants for different platforms.', agents: ['copy-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Ad copy variants'] },
        { id: 'mkt.campaign.creative', name: 'Creative generation', description: 'Generate visual creatives for campaigns.', agents: ['creative-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Creative assets', 'Size variants'] },
        { id: 'mkt.campaign.budget', name: 'Budget allocation', description: 'Optimize budget distribution across channels.', agents: ['optimization-agent', 'analytics-mkt-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Budget plan', 'ROI projections'] },
        { id: 'mkt.campaign.audience', name: 'Audience targeting', description: 'Define and refine target audience segments.', agents: ['campaign-agent', 'analytics-mkt-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Audience segments', 'Targeting criteria'] },
      ]},
      { name: 'Content', skills: [
        { id: 'mkt.content.blog', name: 'Blog writing', description: 'Write SEO-optimized blog posts.', agents: ['copy-agent'], estimatedTime: '~5m', complexity: 'moderate', outputs: ['Blog post', 'Meta tags'] },
        { id: 'mkt.content.email', name: 'Email campaigns', description: 'Design and write email campaign sequences.', agents: ['copy-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Email sequence', 'Subject lines'] },
        { id: 'mkt.content.social', name: 'Social media posts', description: 'Generate social media content for multiple platforms.', agents: ['copy-agent', 'creative-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Social posts', 'Hashtags'] },
        { id: 'mkt.content.landing', name: 'Landing page generation', description: 'Design and generate landing page content.', agents: ['landing-page-agent', 'copy-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Landing page', 'Copy blocks'] },
        { id: 'mkt.content.video', name: 'Video script writing', description: 'Write scripts for marketing videos.', agents: ['copy-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Video script', 'Storyboard outline'] },
        { id: 'mkt.content.newsletter', name: 'Newsletter creation', description: 'Create newsletter content with curated sections.', agents: ['copy-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Newsletter draft'] },
      ]},
      { name: 'Analytics', skills: [
        { id: 'mkt.analytics.performance', name: 'Campaign performance analysis', description: 'Analyze campaign results and ROI.', agents: ['analytics-mkt-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Performance report', 'ROI analysis'] },
        { id: 'mkt.analytics.funnel', name: 'Funnel analysis', description: 'Analyze conversion funnels and identify drop-offs.', agents: ['analytics-mkt-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Funnel report', 'Drop-off analysis'] },
        { id: 'mkt.analytics.attribution', name: 'Attribution analysis', description: 'Determine channel attribution for conversions.', agents: ['analytics-mkt-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Attribution model', 'Channel impact'] },
        { id: 'mkt.analytics.ctr', name: 'CTR optimization', description: 'Analyze and optimize click-through rates.', agents: ['optimization-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['CTR report', 'Optimization suggestions'] },
        { id: 'mkt.analytics.conversion', name: 'Conversion analysis', description: 'Deep dive into conversion metrics.', agents: ['analytics-mkt-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Conversion report'] },
      ]},
      { name: 'Optimization', skills: [
        { id: 'mkt.opt.creative', name: 'Creative refresh', description: 'Identify and regenerate underperforming creatives.', agents: ['optimization-agent', 'creative-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['New creative variants'] },
        { id: 'mkt.opt.audience', name: 'Audience adjustment', description: 'Refine audience targeting based on performance data.', agents: ['optimization-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Updated segments'] },
        { id: 'mkt.opt.budget', name: 'Budget optimization', description: 'Reallocate budget based on channel performance.', agents: ['optimization-agent', 'analytics-mkt-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Budget reallocation plan'] },
        { id: 'mkt.opt.ab', name: 'A/B test generation', description: 'Design A/B tests for copy, creative, and landing pages.', agents: ['optimization-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Test plan', 'Variants'] },
      ]},
    ],
    agents: [
      { id: 'campaign-agent', name: 'Campaign Agent', description: 'Plans and launches marketing campaigns.', tools: ['hubspot', 'linkedin-ads', 'google-ads', 'meta-ads'], status: 'active' },
      { id: 'creative-agent', name: 'Creative Agent', description: 'Generates visual assets and creatives.', tools: ['canva', 'nano-banana', 'dalle', 'figma'], status: 'active' },
      { id: 'copy-agent', name: 'Copy Agent', description: 'Writes ad copy, blogs, emails, and social posts.', tools: ['hubspot', 'google-docs'], status: 'active' },
      { id: 'landing-page-agent', name: 'Landing Page Agent', description: 'Designs and builds landing pages.', tools: ['lovable', 'figma'], status: 'beta' },
      { id: 'analytics-mkt-agent', name: 'Analytics Agent', description: 'Analyzes campaign performance and attribution.', tools: ['ga4', 'mixpanel', 'hubspot'], status: 'active' },
      { id: 'optimization-agent', name: 'Optimization Agent', description: 'Optimizes campaigns based on performance signals.', tools: ['ga4', 'linkedin-ads', 'google-ads'], status: 'beta' },
    ],
    tools: [
      { id: 'hubspot', name: 'HubSpot', icon: '🟠', category: 'CRM', authType: 'oauth', connected: true, description: 'Marketing automation and CRM' },
      { id: 'salesforce-mkt', name: 'Salesforce', icon: '☁️', category: 'CRM', authType: 'oauth', connected: false, description: 'CRM platform' },
      { id: 'linkedin-ads', name: 'LinkedIn Ads', icon: '💼', category: 'Advertising', authType: 'oauth', connected: true, description: 'B2B advertising' },
      { id: 'google-ads', name: 'Google Ads', icon: '🔍', category: 'Advertising', authType: 'oauth', connected: false, description: 'Search and display ads' },
      { id: 'meta-ads', name: 'Meta Ads', icon: '📘', category: 'Advertising', authType: 'oauth', connected: false, description: 'Social advertising' },
      { id: 'canva', name: 'Canva', icon: '🎨', category: 'Design', authType: 'oauth', connected: true, description: 'Graphic design' },
      { id: 'nano-banana', name: 'Nano Banana', icon: '🍌', category: 'AI Design', authType: 'api_key', connected: false, description: 'AI image generation' },
      { id: 'dalle', name: 'DALL-E', icon: '🖼️', category: 'AI Design', authType: 'api_key', connected: false, description: 'AI image generation' },
      { id: 'figma-mkt', name: 'Figma', icon: '🎨', category: 'Design', authType: 'oauth', connected: true, description: 'Design tool' },
      { id: 'lovable', name: 'Lovable', icon: '💜', category: 'Landing Pages', authType: 'api_key', connected: false, description: 'AI landing page builder' },
      { id: 'ga4', name: 'GA4', icon: '📊', category: 'Analytics', authType: 'oauth', connected: true, description: 'Google Analytics' },
      { id: 'mixpanel-mkt', name: 'Mixpanel', icon: '📈', category: 'Analytics', authType: 'api_key', connected: false, description: 'Product analytics' },
    ],
    courses: [
      { id: 'c-mkt-1', title: 'Performance marketing', provider: 'Google', duration: '6h', level: 'intermediate', url: 'https://grow.google/ai' },
      { id: 'c-mkt-2', title: 'Content strategy', provider: 'HubSpot', duration: '4h', level: 'beginner', url: '#' },
      { id: 'c-mkt-3', title: 'AI marketing workflows', provider: 'Internal', duration: '3h', level: 'intermediate', url: '#' },
      { id: 'c-mkt-4', title: 'Analytics interpretation', provider: 'Google', duration: '5h', level: 'intermediate', url: '#' },
    ],
    promptExamples: [
      'Launch LinkedIn campaign for AI webinar',
      'Generate creative for B2B fintech campaign',
      'Analyze GA4 funnel performance',
      'Write email sequence for product launch',
      'Create A/B test for landing page headline',
    ],
  },

  // ── 4. PROGRAM / DELIVERY ──
  {
    id: 'program', name: 'Program / Delivery', icon: '📋', color: '#10b981',
    description: 'Program management — planning, dependency tracking, risk management, and status reporting.',
    skillCategories: [
      { name: 'Planning', skills: [
        { id: 'pgm.plan.program', name: 'Program planning', description: 'Create comprehensive program plans with workstreams.', agents: ['delivery-tracking-agent', 'dependency-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Program plan', 'Workstreams', 'Timeline'] },
        { id: 'pgm.plan.deps', name: 'Dependency mapping', description: 'Map cross-team and cross-system dependencies.', agents: ['dependency-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Dependency graph', 'Critical path'] },
        { id: 'pgm.plan.timeline', name: 'Timeline generation', description: 'Generate project timelines with milestones.', agents: ['delivery-tracking-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Gantt chart', 'Milestone plan'] },
        { id: 'pgm.plan.risk', name: 'Risk detection', description: 'Identify and assess project risks.', agents: ['risk-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Risk register', 'Mitigation plan'] },
        { id: 'pgm.plan.forecast', name: 'Delivery forecasting', description: 'Predict delivery dates based on velocity and scope.', agents: ['delivery-tracking-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Delivery forecast', 'Confidence interval'] },
      ]},
      { name: 'Reporting', skills: [
        { id: 'pgm.report.status', name: 'Status reporting', description: 'Generate weekly/monthly status reports.', agents: ['status-report-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Status report', 'RAG summary'] },
        { id: 'pgm.report.exec', name: 'Executive summary creation', description: 'Create executive-level project summaries.', agents: ['status-report-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Executive summary'] },
        { id: 'pgm.report.meeting', name: 'Meeting summary generation', description: 'Summarize meeting transcripts into action items.', agents: ['status-report-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Meeting summary', 'Action items'] },
        { id: 'pgm.report.stakeholder', name: 'Stakeholder update', description: 'Generate tailored updates for different stakeholders.', agents: ['status-report-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Stakeholder update email'] },
      ]},
    ],
    agents: [
      { id: 'delivery-tracking-agent', name: 'Delivery Tracking Agent', description: 'Tracks project progress and delivery timelines.', tools: ['jira', 'asana', 'smartsheet'], status: 'active' },
      { id: 'risk-agent', name: 'Risk Agent', description: 'Identifies and monitors project risks.', tools: ['jira', 'confluence'], status: 'active' },
      { id: 'dependency-agent', name: 'Dependency Agent', description: 'Maps and tracks cross-team dependencies.', tools: ['jira', 'notion'], status: 'active' },
      { id: 'status-report-agent', name: 'Status Report Agent', description: 'Generates status reports and executive summaries.', tools: ['confluence', 'slack', 'google-sheets'], status: 'active' },
    ],
    tools: [
      { id: 'jira-pgm', name: 'Jira', icon: '🔷', category: 'Project Management', authType: 'oauth', connected: true, description: 'Issue tracking' },
      { id: 'confluence-pgm', name: 'Confluence', icon: '📝', category: 'Documentation', authType: 'oauth', connected: true, description: 'Wiki' },
      { id: 'slack-pgm', name: 'Slack', icon: '💬', category: 'Communication', authType: 'oauth', connected: true, description: 'Team messaging' },
      { id: 'notion-pgm', name: 'Notion', icon: '📓', category: 'Documentation', authType: 'oauth', connected: false, description: 'Workspace' },
      { id: 'smartsheet', name: 'Smartsheet', icon: '📊', category: 'Project Management', authType: 'oauth', connected: false, description: 'Work management' },
      { id: 'asana', name: 'Asana', icon: '🎯', category: 'Project Management', authType: 'oauth', connected: false, description: 'Task management' },
      { id: 'monday', name: 'Monday', icon: '📅', category: 'Project Management', authType: 'oauth', connected: false, description: 'Work OS' },
      { id: 'google-sheets', name: 'Google Sheets', icon: '📗', category: 'Productivity', authType: 'oauth', connected: true, description: 'Spreadsheets' },
    ],
    courses: [
      { id: 'c-pgm-1', title: 'Program management fundamentals', provider: 'PMI', duration: '8h', level: 'beginner', url: '#' },
      { id: 'c-pgm-2', title: 'Risk management', provider: 'Internal', duration: '4h', level: 'intermediate', url: '#' },
      { id: 'c-pgm-3', title: 'Agile at scale', provider: 'Scaled Agile', duration: '6h', level: 'advanced', url: '#' },
      { id: 'c-pgm-4', title: 'Stakeholder management', provider: 'Internal', duration: '3h', level: 'intermediate', url: '#' },
    ],
    promptExamples: [
      'Generate weekly status report',
      'Map dependencies for Q3 deliverables',
      'Create risk assessment for mobile launch',
      'Summarize today\'s standup meeting',
    ],
  },

  // ── 5. HR / PEOPLE OPS ──
  {
    id: 'hr', name: 'HR / People Ops', icon: '👥', color: '#ec4899',
    description: 'Human resources — recruitment, employee lifecycle, policy management, and people analytics.',
    skillCategories: [
      { name: 'Recruitment', skills: [
        { id: 'hr.recruit.jd', name: 'Job description generation', description: 'Generate role-specific job descriptions.', agents: ['recruitment-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Job description'] },
        { id: 'hr.recruit.screen', name: 'Resume screening', description: 'Screen and score resumes against requirements.', agents: ['resume-screening-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Ranked candidates', 'Score cards'] },
        { id: 'hr.recruit.rank', name: 'Candidate ranking', description: 'Rank candidates based on multiple criteria.', agents: ['resume-screening-agent'], estimatedTime: '~1m', complexity: 'moderate', outputs: ['Ranked list', 'Comparison matrix'] },
        { id: 'hr.recruit.questions', name: 'Interview question generation', description: 'Generate role-specific interview questions.', agents: ['recruitment-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Question bank', 'Rubric'] },
        { id: 'hr.recruit.evaluation', name: 'Hiring evaluation', description: 'Create evaluation framework for hiring decisions.', agents: ['recruitment-agent', 'hr-analytics-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Evaluation framework', 'Decision matrix'] },
      ]},
      { name: 'Employee Lifecycle', skills: [
        { id: 'hr.lifecycle.onboard', name: 'Onboarding documentation', description: 'Generate onboarding checklists and documentation.', agents: ['policy-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Onboarding checklist', 'Welcome doc'] },
        { id: 'hr.lifecycle.policy', name: 'Policy generation', description: 'Draft and update HR policies.', agents: ['policy-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Policy document'] },
        { id: 'hr.lifecycle.feedback', name: 'Employee feedback analysis', description: 'Analyze engagement surveys and feedback.', agents: ['hr-analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Sentiment report', 'Themes'] },
        { id: 'hr.lifecycle.review', name: 'Performance review summary', description: 'Summarize and analyze performance reviews.', agents: ['hr-analytics-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Review summary', 'Development areas'] },
        { id: 'hr.lifecycle.learning', name: 'Learning path generation', description: 'Create personalized learning paths for employees.', agents: ['policy-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Learning path', 'Course recommendations'] },
      ]},
    ],
    agents: [
      { id: 'recruitment-agent', name: 'Recruitment Agent', description: 'Assists with job postings and interview preparation.', tools: ['greenhouse', 'lever', 'linkedin'], status: 'active' },
      { id: 'resume-screening-agent', name: 'Resume Screening Agent', description: 'Screens and ranks candidate resumes.', tools: ['greenhouse', 'lever'], status: 'active' },
      { id: 'policy-agent', name: 'Policy Agent', description: 'Drafts and manages HR policies and documentation.', tools: ['google-workspace', 'darwinbox'], status: 'active' },
      { id: 'hr-analytics-agent', name: 'HR Analytics Agent', description: 'Analyzes people data and engagement metrics.', tools: ['darwinbox', 'workday'], status: 'beta' },
    ],
    tools: [
      { id: 'darwinbox', name: 'Darwinbox', icon: '🧬', category: 'HRIS', authType: 'oauth', connected: false, description: 'HR management system' },
      { id: 'workday', name: 'Workday', icon: '🏢', category: 'HRIS', authType: 'oauth', connected: false, description: 'HR and finance platform' },
      { id: 'greenhouse', name: 'Greenhouse', icon: '🌱', category: 'ATS', authType: 'oauth', connected: false, description: 'Applicant tracking' },
      { id: 'lever', name: 'Lever', icon: '🔩', category: 'ATS', authType: 'oauth', connected: false, description: 'Recruiting software' },
      { id: 'linkedin-hr', name: 'LinkedIn', icon: '💼', category: 'Recruiting', authType: 'oauth', connected: true, description: 'Professional network' },
      { id: 'google-workspace', name: 'Google Workspace', icon: '🔵', category: 'Productivity', authType: 'oauth', connected: true, description: 'Productivity suite' },
    ],
    courses: [
      { id: 'c-hr-1', title: 'Modern recruitment', provider: 'LinkedIn Learning', duration: '4h', level: 'beginner', url: '#' },
      { id: 'c-hr-2', title: 'People analytics', provider: 'Coursera', duration: '6h', level: 'intermediate', url: '#' },
      { id: 'c-hr-3', title: 'HR compliance', provider: 'Internal', duration: '3h', level: 'intermediate', url: '#' },
      { id: 'c-hr-4', title: 'Employee experience design', provider: 'IDEO', duration: '5h', level: 'advanced', url: '#' },
    ],
    promptExamples: [
      'Write JD for Senior AI Engineer',
      'Screen resumes for product manager role',
      'Generate onboarding plan for new engineering hire',
      'Analyze Q2 employee engagement survey',
    ],
  },

  // ── 6. FINANCE ──
  {
    id: 'finance', name: 'Finance', icon: '💰', color: '#06b6d4',
    description: 'Financial operations — forecasting, budgeting, expense analysis, and invoicing.',
    skillCategories: [
      { name: 'Analysis', skills: [
        { id: 'fin.analysis.forecast', name: 'Financial forecasting', description: 'Generate financial forecasts and projections.', agents: ['forecasting-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Forecast model', 'Projections'] },
        { id: 'fin.analysis.budget', name: 'Budget planning', description: 'Create detailed budget plans for departments.', agents: ['finance-analysis-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Budget plan', 'Allocation breakdown'] },
        { id: 'fin.analysis.expense', name: 'Expense analysis', description: 'Analyze spending patterns and identify savings.', agents: ['expense-monitoring-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Expense report', 'Savings opportunities'] },
        { id: 'fin.analysis.revenue', name: 'Revenue analytics', description: 'Analyze revenue streams and trends.', agents: ['finance-analysis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Revenue report', 'Trend analysis'] },
        { id: 'fin.analysis.cost', name: 'Cost modeling', description: 'Build cost models for initiatives and products.', agents: ['finance-analysis-agent', 'forecasting-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Cost model', 'Break-even analysis'] },
        { id: 'fin.analysis.cashflow', name: 'Cash flow forecasting', description: 'Forecast cash flow and liquidity position.', agents: ['forecasting-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Cash flow forecast'] },
      ]},
      { name: 'Operations', skills: [
        { id: 'fin.ops.invoice', name: 'Invoice generation', description: 'Generate and send invoices.', agents: ['invoice-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Invoice'] },
        { id: 'fin.ops.vendor', name: 'Vendor comparison', description: 'Compare vendors on cost, quality, and terms.', agents: ['finance-analysis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Vendor comparison matrix'] },
        { id: 'fin.ops.procurement', name: 'Procurement analysis', description: 'Analyze procurement spending and opportunities.', agents: ['expense-monitoring-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Procurement report'] },
        { id: 'fin.ops.audit', name: 'Audit preparation', description: 'Prepare documentation for financial audits.', agents: ['finance-analysis-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Audit package', 'Documentation checklist'] },
      ]},
    ],
    agents: [
      { id: 'finance-analysis-agent', name: 'Finance Analysis Agent', description: 'Analyzes financial data and generates reports.', tools: ['quickbooks', 'netsuite', 'excel', 'snowflake'], status: 'active' },
      { id: 'forecasting-agent', name: 'Forecasting Agent', description: 'Creates financial forecasts and projections.', tools: ['excel', 'snowflake'], status: 'active' },
      { id: 'expense-monitoring-agent', name: 'Expense Monitoring Agent', description: 'Tracks and analyzes expenses.', tools: ['quickbooks', 'netsuite', 'stripe'], status: 'active' },
      { id: 'invoice-agent', name: 'Invoice Agent', description: 'Generates and manages invoices.', tools: ['quickbooks', 'stripe'], status: 'active' },
    ],
    tools: [
      { id: 'quickbooks', name: 'QuickBooks', icon: '💚', category: 'Accounting', authType: 'oauth', connected: false, description: 'Accounting software' },
      { id: 'netsuite', name: 'NetSuite', icon: '🟤', category: 'ERP', authType: 'oauth', connected: false, description: 'ERP platform' },
      { id: 'sap', name: 'SAP', icon: '🔵', category: 'ERP', authType: 'oauth', connected: false, description: 'Enterprise ERP' },
      { id: 'stripe', name: 'Stripe', icon: '💳', category: 'Payments', authType: 'api_key', connected: true, description: 'Payment processing' },
      { id: 'excel', name: 'Excel', icon: '📗', category: 'Productivity', authType: 'oauth', connected: true, description: 'Spreadsheets' },
      { id: 'snowflake-fin', name: 'Snowflake', icon: '❄️', category: 'Data', authType: 'api_key', connected: false, description: 'Cloud data warehouse' },
    ],
    courses: [
      { id: 'c-fin-1', title: 'Financial modeling', provider: 'CFI', duration: '10h', level: 'advanced', url: '#' },
      { id: 'c-fin-2', title: 'Budget management', provider: 'Internal', duration: '4h', level: 'intermediate', url: '#' },
      { id: 'c-fin-3', title: 'AI in finance', provider: 'DeepLearning.AI', duration: '5h', level: 'intermediate', url: '#' },
      { id: 'c-fin-4', title: 'Cost optimization strategies', provider: 'Internal', duration: '3h', level: 'intermediate', url: '#' },
    ],
    promptExamples: [
      'Create Q3 budget forecast',
      'Analyze SaaS spending trends',
      'Generate invoice for vendor payment',
      'Model cost of new AI infrastructure',
    ],
  },

  // ── 7. DATA / ANALYTICS ──
  {
    id: 'data', name: 'Data / Analytics', icon: '📊', color: '#6366f1',
    description: 'Data operations — SQL, dashboards, pipelines, quality checks, and insights.',
    skillCategories: [
      { name: 'Querying', skills: [
        { id: 'data.query.sql', name: 'SQL generation', description: 'Generate SQL queries from natural language.', agents: ['sql-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['SQL query', 'Results'] },
        { id: 'data.query.optimize', name: 'Query optimization', description: 'Optimize slow queries for performance.', agents: ['sql-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Optimized query', 'Execution plan'] },
        { id: 'data.query.extract', name: 'Data extraction', description: 'Extract datasets from multiple sources.', agents: ['sql-agent', 'pipeline-debug-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Dataset', 'Extract script'] },
        { id: 'data.query.schema', name: 'Schema exploration', description: 'Explore and document database schemas.', agents: ['sql-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Schema documentation'] },
      ]},
      { name: 'Visualization', skills: [
        { id: 'data.viz.dashboard', name: 'Dashboard creation', description: 'Design and create data dashboards.', agents: ['dashboard-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Dashboard', 'Widget definitions'] },
        { id: 'data.viz.chart', name: 'Chart generation', description: 'Generate charts and visualizations from data.', agents: ['dashboard-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Chart', 'Configuration'] },
        { id: 'data.viz.report', name: 'Report building', description: 'Build automated reports with key metrics.', agents: ['dashboard-agent', 'insight-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Report template'] },
        { id: 'data.viz.kpi', name: 'KPI tracking', description: 'Set up KPI tracking dashboards.', agents: ['dashboard-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['KPI dashboard'] },
      ]},
      { name: 'Engineering', skills: [
        { id: 'data.eng.pipeline', name: 'Data pipeline debugging', description: 'Debug failing data pipelines and ETL jobs.', agents: ['pipeline-debug-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Root cause', 'Fix suggestion'] },
        { id: 'data.eng.quality', name: 'Data quality checks', description: 'Run data quality checks and report anomalies.', agents: ['data-quality-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Quality report', 'Anomalies'] },
        { id: 'data.eng.etl', name: 'ETL optimization', description: 'Optimize ETL pipelines for performance.', agents: ['pipeline-debug-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Optimization plan'] },
        { id: 'data.eng.migration', name: 'Schema migration', description: 'Generate schema migration scripts.', agents: ['sql-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Migration script', 'Rollback plan'] },
      ]},
    ],
    agents: [
      { id: 'sql-agent', name: 'SQL Agent', description: 'Generates and optimizes SQL queries.', tools: ['snowflake', 'bigquery', 'databricks'], status: 'active' },
      { id: 'dashboard-agent', name: 'Dashboard Agent', description: 'Creates dashboards and visualizations.', tools: ['power-bi', 'looker', 'tableau'], status: 'active' },
      { id: 'data-quality-agent', name: 'Data Quality Agent', description: 'Runs data quality checks and validations.', tools: ['snowflake', 'bigquery'], status: 'active' },
      { id: 'pipeline-debug-agent', name: 'Pipeline Debug Agent', description: 'Debugs data pipeline failures.', tools: ['databricks', 'snowflake'], status: 'beta' },
      { id: 'insight-agent', name: 'Insight Agent', description: 'Extracts insights from data analysis.', tools: ['snowflake', 'bigquery', 'python'], status: 'beta' },
    ],
    tools: [
      { id: 'snowflake', name: 'Snowflake', icon: '❄️', category: 'Data Warehouse', authType: 'api_key', connected: true, description: 'Cloud data warehouse' },
      { id: 'bigquery', name: 'BigQuery', icon: '🟦', category: 'Data Warehouse', authType: 'oauth', connected: false, description: 'Google data warehouse' },
      { id: 'databricks', name: 'Databricks', icon: '🧱', category: 'Data Platform', authType: 'api_key', connected: false, description: 'Unified analytics platform' },
      { id: 'power-bi', name: 'Power BI', icon: '📊', category: 'BI', authType: 'oauth', connected: false, description: 'Business intelligence' },
      { id: 'looker', name: 'Looker', icon: '👁️', category: 'BI', authType: 'oauth', connected: false, description: 'Data exploration' },
      { id: 'tableau', name: 'Tableau', icon: '📈', category: 'BI', authType: 'oauth', connected: false, description: 'Data visualization' },
      { id: 'python', name: 'Python', icon: '🐍', category: 'Programming', authType: 'mcp', connected: true, description: 'Python runtime' },
    ],
    courses: [
      { id: 'c-data-1', title: 'Advanced SQL', provider: 'DataCamp', duration: '6h', level: 'intermediate', url: '#' },
      { id: 'c-data-2', title: 'Data visualization', provider: 'Tableau', duration: '4h', level: 'beginner', url: '#' },
      { id: 'c-data-3', title: 'Data engineering', provider: 'Databricks', duration: '8h', level: 'advanced', url: '#' },
      { id: 'c-data-4', title: 'ML fundamentals', provider: 'DeepLearning.AI', duration: '10h', level: 'intermediate', url: 'https://deeplearning.ai' },
      { id: 'c-data-5', title: 'Analytics storytelling', provider: 'Internal', duration: '3h', level: 'beginner', url: '#' },
    ],
    promptExamples: [
      'Generate SQL for monthly active users by cohort',
      'Create dashboard for product metrics',
      'Debug failing ETL pipeline',
      'Run data quality check on customer table',
    ],
  },

  // ── 8. CORP IT ──
  {
    id: 'corpit', name: 'Corp IT', icon: '🏛️', color: '#64748b',
    description: 'IT governance — license management, access control, device management, and IT operations.',
    skillCategories: [
      { name: 'License Management', skills: [
        { id: 'it.license.monitor', name: 'Tool license monitoring', description: 'Monitor license usage across all tools.', agents: ['license-monitoring-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['License usage report'] },
        { id: 'it.license.cost', name: 'License cost tracking', description: 'Track and analyze license costs.', agents: ['license-monitoring-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Cost breakdown', 'Spending trends'] },
        { id: 'it.license.renewal', name: 'License renewal alerts', description: 'Track expiration dates and send renewal alerts.', agents: ['license-monitoring-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Renewal calendar', 'Alerts'] },
        { id: 'it.license.adoption', name: 'Tool adoption analytics', description: 'Analyze tool usage patterns and adoption.', agents: ['license-monitoring-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Adoption report', 'Usage heatmap'] },
        { id: 'it.license.optimize', name: 'License optimization', description: 'Identify unused licenses and cost savings.', agents: ['license-monitoring-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Optimization report', 'Savings estimate'] },
      ]},
      { name: 'Access Management', skills: [
        { id: 'it.access.manage', name: 'User tool access management', description: 'Manage user access to enterprise tools.', agents: ['access-provisioning-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Access matrix'] },
        { id: 'it.access.provision', name: 'Access provisioning', description: 'Provision new tool access for users.', agents: ['access-provisioning-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Provisioning confirmation'] },
        { id: 'it.access.revoke', name: 'Access revocation', description: 'Revoke tool access for offboarded users.', agents: ['access-provisioning-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Revocation confirmation'] },
        { id: 'it.access.sso', name: 'SSO configuration', description: 'Configure SSO for enterprise applications.', agents: ['access-provisioning-agent', 'policy-enforcement-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['SSO configuration', 'Test results'] },
      ]},
      { name: 'Infrastructure', skills: [
        { id: 'it.infra.device', name: 'Device management', description: 'Manage and monitor enterprise devices.', agents: ['device-monitoring-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Device inventory', 'Health report'] },
        { id: 'it.infra.incident', name: 'IT incident management', description: 'Manage and resolve IT support incidents.', agents: ['it-helpdesk-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Incident resolution', 'Root cause'] },
        { id: 'it.infra.asset', name: 'Asset tracking', description: 'Track hardware and software assets.', agents: ['device-monitoring-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Asset report'] },
        { id: 'it.infra.patching', name: 'Security patching', description: 'Manage security patch deployment.', agents: ['policy-enforcement-agent', 'device-monitoring-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Patch schedule', 'Compliance report'] },
      ]},
    ],
    agents: [
      { id: 'license-monitoring-agent', name: 'License Monitoring Agent', description: 'Monitors and reports on software license usage.', tools: ['okta', 'azure-ad', 'google-workspace-it'], status: 'active' },
      { id: 'access-provisioning-agent', name: 'Access Provisioning Agent', description: 'Manages user access and SSO configuration.', tools: ['okta', 'azure-ad'], status: 'active' },
      { id: 'device-monitoring-agent', name: 'Device Monitoring Agent', description: 'Monitors enterprise device health and compliance.', tools: ['intune', 'jamf'], status: 'active' },
      { id: 'it-helpdesk-agent', name: 'IT Helpdesk Agent', description: 'Handles IT support tickets and incidents.', tools: ['jira-service-desk', 'zendesk-it'], status: 'active' },
      { id: 'policy-enforcement-agent', name: 'Policy Enforcement Agent', description: 'Enforces IT policies and compliance.', tools: ['okta', 'intune'], status: 'beta' },
    ],
    tools: [
      { id: 'okta', name: 'Okta', icon: '🔐', category: 'Identity', authType: 'oauth', connected: true, description: 'Identity provider' },
      { id: 'azure-ad', name: 'Azure AD', icon: '🔷', category: 'Identity', authType: 'oauth', connected: true, description: 'Microsoft identity' },
      { id: 'google-workspace-it', name: 'Google Workspace', icon: '🔵', category: 'Productivity', authType: 'oauth', connected: true, description: 'Productivity suite' },
      { id: 'jira-service-desk', name: 'Jira Service Desk', icon: '🎫', category: 'ITSM', authType: 'oauth', connected: true, description: 'IT service management' },
      { id: 'zendesk-it', name: 'Zendesk', icon: '🟢', category: 'Support', authType: 'oauth', connected: false, description: 'Support platform' },
      { id: 'intune', name: 'Intune', icon: '📱', category: 'MDM', authType: 'oauth', connected: false, description: 'Device management' },
      { id: 'jamf', name: 'Jamf', icon: '🍎', category: 'MDM', authType: 'oauth', connected: false, description: 'Apple device management' },
    ],
    courses: [
      { id: 'c-it-1', title: 'IT governance', provider: 'ISACA', duration: '6h', level: 'intermediate', url: '#' },
      { id: 'c-it-2', title: 'License management', provider: 'Internal', duration: '3h', level: 'beginner', url: '#' },
      { id: 'c-it-3', title: 'Zero trust security', provider: 'Microsoft', duration: '5h', level: 'advanced', url: 'https://learn.microsoft.com/training' },
      { id: 'c-it-4', title: 'ITIL fundamentals', provider: 'PeopleCert', duration: '8h', level: 'intermediate', url: '#' },
    ],
    promptExamples: [
      'Show unused licenses across all tools',
      'Provision Figma access for design team',
      'Generate IT spend report for Q3',
      'Check device compliance for engineering laptops',
    ],
  },

  // ── 9. SALES / GTM ──
  {
    id: 'sales', name: 'Sales / GTM', icon: '🎯', color: '#ef4444',
    description: 'Sales operations — prospecting, proposals, deal management, and pipeline analytics.',
    skillCategories: [
      { name: 'Prospecting', skills: [
        { id: 'sales.prospect.research', name: 'Lead research', description: 'Research and qualify potential leads.', agents: ['prospecting-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Lead profiles', 'Qualification scores'] },
        { id: 'sales.prospect.icp', name: 'ICP identification', description: 'Define and refine ideal customer profiles.', agents: ['prospecting-agent', 'competitive-intel-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['ICP document', 'Target list'] },
        { id: 'sales.prospect.outreach', name: 'Outreach generation', description: 'Generate personalized outreach messages.', agents: ['prospecting-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Outreach sequence'] },
        { id: 'sales.prospect.linkedin', name: 'LinkedIn prospecting', description: 'Find and engage prospects on LinkedIn.', agents: ['prospecting-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Prospect list', 'Connection requests'] },
        { id: 'sales.prospect.email', name: 'Email sequences', description: 'Create multi-step email sequences.', agents: ['prospecting-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Email sequence', 'Follow-up cadence'] },
      ]},
      { name: 'Deal Management', skills: [
        { id: 'sales.deal.proposal', name: 'Proposal generation', description: 'Generate tailored sales proposals.', agents: ['proposal-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Proposal document', 'Pricing page'] },
        { id: 'sales.deal.contract', name: 'Contract drafting', description: 'Draft initial contract terms.', agents: ['proposal-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Contract draft'] },
        { id: 'sales.deal.pricing', name: 'Pricing configuration', description: 'Configure pricing for deals.', agents: ['deal-analysis-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Pricing sheet', 'Discount analysis'] },
        { id: 'sales.deal.scoring', name: 'Deal scoring', description: 'Score deals based on engagement and fit.', agents: ['deal-analysis-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Deal score', 'Risk factors'] },
        { id: 'sales.deal.battlecard', name: 'Competitive battlecard', description: 'Generate competitive battlecards.', agents: ['competitive-intel-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Battlecard', 'Win themes'] },
      ]},
      { name: 'Analytics', skills: [
        { id: 'sales.analytics.pipeline', name: 'Pipeline analysis', description: 'Analyze sales pipeline health and velocity.', agents: ['deal-analysis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Pipeline report', 'Velocity metrics'] },
        { id: 'sales.analytics.winloss', name: 'Win/loss analysis', description: 'Analyze won and lost deals for patterns.', agents: ['deal-analysis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Win/loss report', 'Key themes'] },
        { id: 'sales.analytics.revenue', name: 'Revenue forecasting', description: 'Forecast revenue based on pipeline and trends.', agents: ['deal-analysis-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Revenue forecast'] },
        { id: 'sales.analytics.territory', name: 'Territory planning', description: 'Plan and optimize sales territories.', agents: ['deal-analysis-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Territory plan', 'Coverage map'] },
      ]},
    ],
    agents: [
      { id: 'prospecting-agent', name: 'Prospecting Agent', description: 'Researches and qualifies leads.', tools: ['salesforce', 'hubspot', 'linkedin-sales', 'zoominfo'], status: 'active' },
      { id: 'proposal-agent', name: 'Proposal Agent', description: 'Generates proposals and contracts.', tools: ['salesforce', 'docusign'], status: 'active' },
      { id: 'deal-analysis-agent', name: 'Deal Analysis Agent', description: 'Analyzes pipeline and deal performance.', tools: ['salesforce', 'hubspot', 'gong'], status: 'active' },
      { id: 'competitive-intel-agent', name: 'Competitive Intel Agent', description: 'Gathers competitive intelligence.', tools: ['salesforce', 'outreach'], status: 'beta' },
    ],
    tools: [
      { id: 'salesforce', name: 'Salesforce', icon: '☁️', category: 'CRM', authType: 'oauth', connected: true, description: 'CRM platform' },
      { id: 'hubspot-sales', name: 'HubSpot', icon: '🟠', category: 'CRM', authType: 'oauth', connected: false, description: 'CRM and sales hub' },
      { id: 'linkedin-sales', name: 'LinkedIn Sales Navigator', icon: '💼', category: 'Prospecting', authType: 'oauth', connected: true, description: 'Sales prospecting' },
      { id: 'outreach', name: 'Outreach', icon: '📧', category: 'Sales Engagement', authType: 'oauth', connected: false, description: 'Sales engagement platform' },
      { id: 'gong', name: 'Gong', icon: '🔔', category: 'Revenue Intelligence', authType: 'oauth', connected: false, description: 'Conversation intelligence' },
      { id: 'zoominfo', name: 'ZoomInfo', icon: '🔎', category: 'Data', authType: 'api_key', connected: false, description: 'B2B contact data' },
      { id: 'docusign', name: 'DocuSign', icon: '✍️', category: 'E-Signature', authType: 'oauth', connected: true, description: 'Electronic signatures' },
    ],
    courses: [
      { id: 'c-sales-1', title: 'Consultative selling', provider: 'Internal', duration: '4h', level: 'intermediate', url: '#' },
      { id: 'c-sales-2', title: 'Sales analytics', provider: 'Salesforce', duration: '5h', level: 'intermediate', url: '#' },
      { id: 'c-sales-3', title: 'AI for sales', provider: 'Gong', duration: '3h', level: 'beginner', url: '#' },
      { id: 'c-sales-4', title: 'Account based marketing', provider: 'Internal', duration: '4h', level: 'advanced', url: '#' },
    ],
    promptExamples: [
      'Research prospects in enterprise banking',
      'Generate proposal for AI platform deal',
      'Analyze Q2 pipeline conversion rates',
      'Create battlecard vs competitor X',
    ],
  },

  // ── 10. DESIGN ──
  {
    id: 'design', name: 'Design', icon: '🎨', color: '#d946ef',
    description: 'Design operations — wireframes, design systems, brand assets, and UX research.',
    skillCategories: [
      { name: 'UI/UX', skills: [
        { id: 'design.ux.wireframe', name: 'Wireframe generation', description: 'Generate wireframes from feature descriptions.', agents: ['wireframe-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Wireframes', 'Annotations'] },
        { id: 'design.ux.flow', name: 'User flow design', description: 'Design user flows and task maps.', agents: ['wireframe-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['User flow diagram'] },
        { id: 'design.ux.system', name: 'Design system documentation', description: 'Document design system components and patterns.', agents: ['design-system-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Component docs', 'Style guide'] },
        { id: 'design.ux.a11y', name: 'Accessibility audit', description: 'Audit designs for accessibility compliance.', agents: ['design-system-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Accessibility report', 'WCAG compliance'] },
        { id: 'design.ux.usability', name: 'Usability analysis', description: 'Analyze designs for usability issues.', agents: ['research-synthesis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Usability report'] },
      ]},
      { name: 'Visual', skills: [
        { id: 'design.visual.brand', name: 'Brand asset generation', description: 'Generate brand-consistent visual assets.', agents: ['brand-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Brand assets'] },
        { id: 'design.visual.icon', name: 'Icon design', description: 'Design custom icon sets.', agents: ['brand-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Icon set'] },
        { id: 'design.visual.illustration', name: 'Illustration generation', description: 'Create illustrations for products and marketing.', agents: ['brand-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Illustrations'] },
        { id: 'design.visual.collateral', name: 'Marketing collateral', description: 'Design marketing materials and presentations.', agents: ['brand-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Collateral files'] },
      ]},
      { name: 'Research', skills: [
        { id: 'design.research.synthesis', name: 'User research synthesis', description: 'Synthesize findings from user research sessions.', agents: ['research-synthesis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Research synthesis', 'Insights'] },
        { id: 'design.research.heuristic', name: 'Heuristic evaluation', description: 'Evaluate designs against usability heuristics.', agents: ['research-synthesis-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Heuristic report'] },
        { id: 'design.research.competitive', name: 'Competitive design analysis', description: 'Analyze competitor design patterns.', agents: ['research-synthesis-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Design comparison'] },
        { id: 'design.research.persona', name: 'Persona creation', description: 'Create user personas from research data.', agents: ['research-synthesis-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['User personas'] },
      ]},
    ],
    agents: [
      { id: 'design-system-agent', name: 'Design System Agent', description: 'Manages design system documentation and components.', tools: ['figma', 'zeplin'], status: 'active' },
      { id: 'wireframe-agent', name: 'Wireframe Agent', description: 'Generates wireframes and user flows.', tools: ['figma', 'miro'], status: 'active' },
      { id: 'brand-agent', name: 'Brand Agent', description: 'Creates brand-consistent visual assets.', tools: ['canva', 'figma', 'adobe-xd'], status: 'beta' },
      { id: 'research-synthesis-agent', name: 'Research Synthesis Agent', description: 'Synthesizes user research findings.', tools: ['miro', 'notion'], status: 'active' },
    ],
    tools: [
      { id: 'figma-design', name: 'Figma', icon: '🎨', category: 'Design', authType: 'oauth', connected: true, description: 'Collaborative design tool' },
      { id: 'canva-design', name: 'Canva', icon: '🖌️', category: 'Design', authType: 'oauth', connected: true, description: 'Graphic design' },
      { id: 'adobe-xd', name: 'Adobe XD', icon: '🟣', category: 'Design', authType: 'oauth', connected: false, description: 'UI/UX design' },
      { id: 'sketch', name: 'Sketch', icon: '💎', category: 'Design', authType: 'api_key', connected: false, description: 'Mac design tool' },
      { id: 'miro-design', name: 'Miro', icon: '🗂️', category: 'Collaboration', authType: 'oauth', connected: false, description: 'Online whiteboard' },
      { id: 'invision', name: 'InVision', icon: '🔴', category: 'Prototyping', authType: 'api_key', connected: false, description: 'Prototyping tool' },
      { id: 'zeplin', name: 'Zeplin', icon: '📐', category: 'Handoff', authType: 'api_key', connected: false, description: 'Design-to-dev handoff' },
    ],
    courses: [
      { id: 'c-design-1', title: 'Design systems', provider: 'Figma', duration: '5h', level: 'intermediate', url: '#' },
      { id: 'c-design-2', title: 'UX research methods', provider: 'IDEO', duration: '6h', level: 'intermediate', url: '#' },
      { id: 'c-design-3', title: 'Accessibility', provider: 'Deque', duration: '4h', level: 'intermediate', url: '#' },
      { id: 'c-design-4', title: 'Design thinking', provider: 'Stanford d.school', duration: '8h', level: 'beginner', url: '#' },
      { id: 'c-design-5', title: 'AI design tools', provider: 'Internal', duration: '3h', level: 'beginner', url: '#' },
    ],
    promptExamples: [
      'Create wireframe for onboarding flow',
      'Generate design system documentation',
      'Analyze competitor mobile app UX',
      'Create user personas for enterprise buyers',
    ],
  },

  // ── 11. CUSTOMER SUPPORT ──
  {
    id: 'support', name: 'Customer Support', icon: '🎧', color: '#14b8a6',
    description: 'Support operations — ticket management, response automation, CSAT analytics, and knowledge base.',
    skillCategories: [
      { name: 'Ticket Management', skills: [
        { id: 'support.ticket.categorize', name: 'Ticket categorization', description: 'Automatically categorize incoming support tickets.', agents: ['ticket-triage-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Category', 'Priority', 'Tags'] },
        { id: 'support.ticket.respond', name: 'Response generation', description: 'Generate contextual ticket responses.', agents: ['response-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Response draft'] },
        { id: 'support.ticket.escalate', name: 'Escalation routing', description: 'Route tickets to appropriate teams.', agents: ['escalation-agent'], estimatedTime: '~30s', complexity: 'simple', outputs: ['Routing decision'] },
        { id: 'support.ticket.sla', name: 'SLA monitoring', description: 'Monitor SLA compliance across tickets.', agents: ['support-analytics-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['SLA dashboard'] },
        { id: 'support.ticket.kb', name: 'Knowledge base article creation', description: 'Create KB articles from resolved tickets.', agents: ['response-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['KB article'] },
      ]},
      { name: 'Analytics', skills: [
        { id: 'support.analytics.csat', name: 'CSAT analysis', description: 'Analyze customer satisfaction scores and trends.', agents: ['support-analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['CSAT report', 'Trend analysis'] },
        { id: 'support.analytics.response', name: 'Response time tracking', description: 'Track and analyze response times.', agents: ['support-analytics-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['Response time report'] },
        { id: 'support.analytics.trends', name: 'Issue trend analysis', description: 'Identify trending support issues.', agents: ['support-analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Trend report', 'Top issues'] },
        { id: 'support.analytics.performance', name: 'Agent performance review', description: 'Review support agent performance metrics.', agents: ['support-analytics-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Performance dashboard'] },
      ]},
      { name: 'Automation', skills: [
        { id: 'support.auto.chatbot', name: 'Chatbot flow design', description: 'Design conversational chatbot flows.', agents: ['response-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Chatbot flow', 'Intent map'] },
        { id: 'support.auto.faq', name: 'FAQ generation', description: 'Generate FAQ from common support queries.', agents: ['response-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['FAQ document'] },
        { id: 'support.auto.rules', name: 'Auto-response rules', description: 'Create automatic response rules for common issues.', agents: ['ticket-triage-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Rule definitions'] },
        { id: 'support.auto.workflow', name: 'Workflow automation', description: 'Automate support workflows and processes.', agents: ['ticket-triage-agent', 'escalation-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Workflow definition'] },
      ]},
    ],
    agents: [
      { id: 'ticket-triage-agent', name: 'Ticket Triage Agent', description: 'Categorizes and routes support tickets.', tools: ['zendesk', 'intercom', 'freshdesk'], status: 'active' },
      { id: 'response-agent', name: 'Response Agent', description: 'Generates contextual ticket responses.', tools: ['zendesk', 'confluence'], status: 'active' },
      { id: 'escalation-agent', name: 'Escalation Agent', description: 'Handles ticket escalation routing.', tools: ['zendesk', 'jira'], status: 'active' },
      { id: 'support-analytics-agent', name: 'Analytics Agent', description: 'Analyzes support metrics and trends.', tools: ['zendesk', 'intercom'], status: 'beta' },
    ],
    tools: [
      { id: 'zendesk', name: 'Zendesk', icon: '🟢', category: 'Support', authType: 'oauth', connected: true, description: 'Support platform' },
      { id: 'intercom', name: 'Intercom', icon: '💙', category: 'Support', authType: 'oauth', connected: false, description: 'Messaging platform' },
      { id: 'freshdesk', name: 'Freshdesk', icon: '🟩', category: 'Support', authType: 'api_key', connected: false, description: 'Helpdesk software' },
      { id: 'salesforce-service', name: 'Salesforce Service Cloud', icon: '☁️', category: 'CRM', authType: 'oauth', connected: false, description: 'Service CRM' },
      { id: 'jira-support', name: 'Jira', icon: '🔷', category: 'Project Management', authType: 'oauth', connected: true, description: 'Issue tracking' },
      { id: 'confluence-support', name: 'Confluence', icon: '📝', category: 'Knowledge Base', authType: 'oauth', connected: true, description: 'Documentation wiki' },
    ],
    courses: [
      { id: 'c-support-1', title: 'Customer service excellence', provider: 'Internal', duration: '4h', level: 'beginner', url: '#' },
      { id: 'c-support-2', title: 'Support metrics', provider: 'Zendesk', duration: '3h', level: 'intermediate', url: '#' },
      { id: 'c-support-3', title: 'AI in support', provider: 'Internal', duration: '3h', level: 'intermediate', url: '#' },
      { id: 'c-support-4', title: 'Knowledge management', provider: 'Internal', duration: '2h', level: 'beginner', url: '#' },
    ],
    promptExamples: [
      'Categorize incoming support tickets',
      'Generate response for billing inquiry',
      'Analyze CSAT trends for Q2',
      'Create FAQ from last month\'s resolved tickets',
    ],
  },

  // ── 12. LEGAL / COMPLIANCE ──
  {
    id: 'legal', name: 'Legal / Compliance', icon: '⚖️', color: '#78716c',
    description: 'Legal operations — contract review, compliance checks, regulatory research, and privacy assessment.',
    skillCategories: [
      { name: 'Contract Management', skills: [
        { id: 'legal.contract.review', name: 'Contract review', description: 'Review contracts for risks and unfavorable terms.', agents: ['contract-review-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Review summary', 'Risk flags'] },
        { id: 'legal.contract.clause', name: 'Clause extraction', description: 'Extract and categorize key contract clauses.', agents: ['contract-review-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Clause list', 'Categories'] },
        { id: 'legal.contract.risk', name: 'Risk identification', description: 'Identify legal risks in agreements.', agents: ['contract-review-agent'], estimatedTime: '~3m', complexity: 'complex', outputs: ['Risk report'] },
        { id: 'legal.contract.nda', name: 'NDA generation', description: 'Generate standard NDA agreements.', agents: ['contract-review-agent'], estimatedTime: '~1m', complexity: 'simple', outputs: ['NDA document'] },
        { id: 'legal.contract.amend', name: 'Amendment drafting', description: 'Draft contract amendments.', agents: ['contract-review-agent'], estimatedTime: '~3m', complexity: 'moderate', outputs: ['Amendment draft'] },
      ]},
      { name: 'Compliance', skills: [
        { id: 'legal.compliance.check', name: 'Policy compliance check', description: 'Check policies against regulatory requirements.', agents: ['compliance-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Compliance report'] },
        { id: 'legal.compliance.regulatory', name: 'Regulatory analysis', description: 'Analyze applicable regulations for a business activity.', agents: ['compliance-agent', 'legal-research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Regulatory analysis'] },
        { id: 'legal.compliance.audit', name: 'Audit preparation', description: 'Prepare documentation for compliance audits.', agents: ['compliance-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Audit package'] },
        { id: 'legal.compliance.privacy', name: 'Data privacy assessment', description: 'Assess data handling practices for privacy compliance.', agents: ['privacy-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Privacy assessment', 'GDPR checklist'] },
        { id: 'legal.compliance.soc2', name: 'SOC2 readiness', description: 'Assess SOC2 compliance readiness.', agents: ['compliance-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Readiness report', 'Gap analysis'] },
      ]},
      { name: 'Research', skills: [
        { id: 'legal.research.legal', name: 'Legal research', description: 'Research legal topics and precedents.', agents: ['legal-research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Research brief'] },
        { id: 'legal.research.caselaw', name: 'Case law analysis', description: 'Analyze relevant case law and precedents.', agents: ['legal-research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Case analysis'] },
        { id: 'legal.research.updates', name: 'Regulatory update monitoring', description: 'Monitor regulatory changes and updates.', agents: ['legal-research-agent'], estimatedTime: '~2m', complexity: 'moderate', outputs: ['Update digest'] },
        { id: 'legal.research.jurisdiction', name: 'Jurisdiction analysis', description: 'Analyze jurisdictional considerations.', agents: ['legal-research-agent'], estimatedTime: '~5m', complexity: 'complex', outputs: ['Jurisdiction report'] },
      ]},
    ],
    agents: [
      { id: 'contract-review-agent', name: 'Contract Review Agent', description: 'Reviews contracts and identifies risks.', tools: ['docusign-legal', 'ironclad', 'contractpodai'], status: 'active' },
      { id: 'compliance-agent', name: 'Compliance Agent', description: 'Checks compliance with regulations and policies.', tools: ['onetrust', 'google-workspace-legal'], status: 'active' },
      { id: 'legal-research-agent', name: 'Legal Research Agent', description: 'Researches legal topics and precedents.', tools: ['lexisnexis', 'google-workspace-legal'], status: 'beta' },
      { id: 'privacy-agent', name: 'Privacy Agent', description: 'Assesses data privacy compliance.', tools: ['onetrust'], status: 'beta' },
    ],
    tools: [
      { id: 'docusign-legal', name: 'DocuSign', icon: '✍️', category: 'E-Signature', authType: 'oauth', connected: true, description: 'Electronic signatures' },
      { id: 'contractpodai', name: 'ContractPodAI', icon: '📑', category: 'CLM', authType: 'oauth', connected: false, description: 'Contract lifecycle management' },
      { id: 'lexisnexis', name: 'LexisNexis', icon: '📚', category: 'Legal Research', authType: 'api_key', connected: false, description: 'Legal research database' },
      { id: 'onetrust', name: 'OneTrust', icon: '🔒', category: 'Privacy', authType: 'oauth', connected: false, description: 'Privacy management' },
      { id: 'ironclad', name: 'Ironclad', icon: '⛓️', category: 'CLM', authType: 'oauth', connected: false, description: 'Contract management' },
      { id: 'google-workspace-legal', name: 'Google Workspace', icon: '🔵', category: 'Productivity', authType: 'oauth', connected: true, description: 'Productivity suite' },
    ],
    courses: [
      { id: 'c-legal-1', title: 'Legal tech', provider: 'Internal', duration: '4h', level: 'beginner', url: '#' },
      { id: 'c-legal-2', title: 'Contract management', provider: 'Ironclad', duration: '5h', level: 'intermediate', url: '#' },
      { id: 'c-legal-3', title: 'Data privacy regulations', provider: 'OneTrust', duration: '6h', level: 'advanced', url: '#' },
      { id: 'c-legal-4', title: 'AI governance', provider: 'Internal', duration: '4h', level: 'intermediate', url: '#' },
      { id: 'c-legal-5', title: 'Compliance frameworks', provider: 'Internal', duration: '5h', level: 'intermediate', url: '#' },
    ],
    promptExamples: [
      'Review vendor contract for risk clauses',
      'Check GDPR compliance for new feature',
      'Generate NDA for consulting engagement',
      'Monitor regulatory changes in fintech',
    ],
  },
];

// ---------------------------------------------------------------------------
// License Store (Corp IT governance)
// ---------------------------------------------------------------------------

const LICENSE_DATA: LicenseRecord[] = [
  { toolId: 'canva', toolName: 'Canva', icon: '🎨', totalLicenses: 50, usedLicenses: 45, costPerMonth: 540, expirationDate: '2026-12-15', usageFrequency: 72, users: [
    { userId: 'u1', name: 'Sarah Chen', lastUsed: '2026-03-08', role: 'Designer' },
    { userId: 'u2', name: 'Mark Johnson', lastUsed: '2026-03-07', role: 'Marketing Manager' },
    { userId: 'u3', name: 'Lisa Park', lastUsed: '2026-03-06', role: 'Content Creator' },
    { userId: 'u4', name: 'Tom Wilson', lastUsed: '2026-02-14', role: 'Product Manager' },
  ]},
  { toolId: 'hubspot', toolName: 'HubSpot', icon: '🟠', totalLicenses: 15, usedLicenses: 12, costPerMonth: 1200, expirationDate: '2027-02-28', usageFrequency: 89, users: [
    { userId: 'u5', name: 'Emma Roberts', lastUsed: '2026-03-09', role: 'Marketing Lead' },
    { userId: 'u6', name: 'James Lee', lastUsed: '2026-03-08', role: 'SDR' },
    { userId: 'u7', name: 'Nina Patel', lastUsed: '2026-03-09', role: 'Marketing Ops' },
  ]},
  { toolId: 'figma', toolName: 'Figma', icon: '🎨', totalLicenses: 25, usedLicenses: 18, costPerMonth: 360, expirationDate: '2026-10-31', usageFrequency: 65, users: [
    { userId: 'u8', name: 'Alex Kim', lastUsed: '2026-03-09', role: 'Lead Designer' },
    { userId: 'u9', name: 'Priya Sharma', lastUsed: '2026-03-08', role: 'UX Designer' },
    { userId: 'u10', name: 'David Brown', lastUsed: '2026-03-05', role: 'Product Designer' },
  ]},
  { toolId: 'slack', toolName: 'Slack', icon: '💬', totalLicenses: 300, usedLicenses: 250, costPerMonth: 2500, expirationDate: '2027-03-15', usageFrequency: 95, users: [
    { userId: 'u11', name: 'All Employees', lastUsed: '2026-03-09', role: 'Company-wide' },
  ]},
  { toolId: 'jira', toolName: 'Jira', icon: '🔷', totalLicenses: 200, usedLicenses: 180, costPerMonth: 1800, expirationDate: '2027-01-31', usageFrequency: 88, users: [
    { userId: 'u12', name: 'Engineering Team', lastUsed: '2026-03-09', role: 'Engineering' },
    { userId: 'u13', name: 'Product Team', lastUsed: '2026-03-09', role: 'Product' },
    { userId: 'u14', name: 'QA Team', lastUsed: '2026-03-08', role: 'QA' },
  ]},
  { toolId: 'github', toolName: 'GitHub', icon: '🐙', totalLicenses: 100, usedLicenses: 95, costPerMonth: 950, expirationDate: '2027-04-30', usageFrequency: 92, users: [
    { userId: 'u15', name: 'Engineering Org', lastUsed: '2026-03-09', role: 'Engineering' },
  ]},
  { toolId: 'salesforce', toolName: 'Salesforce', icon: '☁️', totalLicenses: 40, usedLicenses: 35, costPerMonth: 3500, expirationDate: '2027-06-30', usageFrequency: 78, users: [
    { userId: 'u16', name: 'Sales Team', lastUsed: '2026-03-09', role: 'Sales' },
    { userId: 'u17', name: 'CS Team', lastUsed: '2026-03-08', role: 'Customer Success' },
    { userId: 'u18', name: 'RevOps', lastUsed: '2026-03-07', role: 'Revenue Operations' },
  ]},
  { toolId: 'datadog', toolName: 'Datadog', icon: '🐕', totalLicenses: 20, usedLicenses: 15, costPerMonth: 750, expirationDate: '2026-11-30', usageFrequency: 85, users: [
    { userId: 'u19', name: 'SRE Team', lastUsed: '2026-03-09', role: 'SRE' },
    { userId: 'u20', name: 'Platform Team', lastUsed: '2026-03-09', role: 'Platform' },
  ]},
  { toolId: 'snowflake', toolName: 'Snowflake', icon: '❄️', totalLicenses: 30, usedLicenses: 22, costPerMonth: 2200, expirationDate: '2027-08-31', usageFrequency: 70, users: [
    { userId: 'u21', name: 'Data Team', lastUsed: '2026-03-09', role: 'Data Engineering' },
    { userId: 'u22', name: 'Analytics Team', lastUsed: '2026-03-08', role: 'Analytics' },
    { userId: 'u23', name: 'BI Team', lastUsed: '2026-03-07', role: 'Business Intelligence' },
  ]},
  { toolId: 'google-workspace', toolName: 'Google Workspace', icon: '🔵', totalLicenses: 320, usedLicenses: 300, costPerMonth: 3600, expirationDate: '2027-05-31', usageFrequency: 98, users: [
    { userId: 'u24', name: 'All Employees', lastUsed: '2026-03-09', role: 'Company-wide' },
  ]},
];

// ---------------------------------------------------------------------------
// PersonaSystem class
// ---------------------------------------------------------------------------

export class PersonaSystem {
  private personas: Persona[] = PERSONAS;

  getAllPersonas(): Array<{ id: string; name: string; icon: string; color: string; description: string; skillCount: number; agentCount: number; toolCount: number }> {
    return this.personas.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      color: p.color,
      description: p.description,
      skillCount: p.skillCategories.reduce((sum, cat) => sum + cat.skills.length, 0),
      agentCount: p.agents.length,
      toolCount: p.tools.length,
    }));
  }

  getPersona(id: string): Persona | undefined {
    return this.personas.find(p => p.id === id);
  }

  getSkillsForPersona(personaId: string): SkillCategory[] {
    const base = this.personas.find(p => p.id === personaId)?.skillCategories ?? [];
    // Merge adopted community skills loaded from skills/<persona>/<slug>/SKILL.md.
    const fs = getFsSkills(personaId);
    if (fs && fs.skills.length > 0) {
      const adopted: Skill[] = fs.skills.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description || s.name,
        agents: [],
        estimatedTime: s.estimatedTime ?? '~varies',
        complexity: (s.complexity ?? 'moderate') as Skill['complexity'],
        outputs: s.outputs ?? [],
      }));
      return [...base, { name: 'Adopted Skills', skills: adopted }];
    }
    return base;
  }

  getAgentsForPersona(personaId: string): AgentDef[] {
    return this.personas.find(p => p.id === personaId)?.agents ?? [];
  }

  getToolsForPersona(personaId: string): ToolDef[] {
    return this.personas.find(p => p.id === personaId)?.tools ?? [];
  }

  getCoursesForPersona(personaId: string): Course[] {
    return this.personas.find(p => p.id === personaId)?.courses ?? [];
  }

  searchSkills(query: string): Array<Skill & { personaId: string; personaName: string; categoryName: string }> {
    const q = query.toLowerCase();
    const results: Array<Skill & { personaId: string; personaName: string; categoryName: string }> = [];
    for (const p of this.personas) {
      for (const cat of p.skillCategories) {
        for (const skill of cat.skills) {
          if (skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)) {
            results.push({ ...skill, personaId: p.id, personaName: p.name, categoryName: cat.name });
          }
        }
      }
    }
    return results;
  }

  getAllTools(): ToolDef[] {
    const seen = new Set<string>();
    const tools: ToolDef[] = [];
    for (const p of this.personas) {
      for (const t of p.tools) {
        const key = t.name.toLowerCase();
        if (!seen.has(key)) { seen.add(key); tools.push(t); }
      }
    }
    return tools;
  }

  getPersonaStats(): { totalPersonas: number; totalSkills: number; totalAgents: number; totalTools: number; totalCourses: number } {
    let totalSkills = 0, totalAgents = 0, totalCourses = 0;
    const toolNames = new Set<string>();
    for (const p of this.personas) {
      totalSkills += p.skillCategories.reduce((s, c) => s + c.skills.length, 0);
      totalAgents += p.agents.length;
      totalCourses += p.courses.length;
      p.tools.forEach(t => toolNames.add(t.name.toLowerCase()));
    }
    return { totalPersonas: this.personas.length, totalSkills, totalAgents, totalTools: toolNames.size, totalCourses };
  }
}

// ---------------------------------------------------------------------------
// LicenseStore class
// ---------------------------------------------------------------------------

export class LicenseStore {
  private licenses: LicenseRecord[] = LICENSE_DATA;

  getAllLicenses(): LicenseRecord[] {
    return this.licenses;
  }

  getLicenseSummary(): { totalCost: number; totalUsers: number; unusedLicenses: number; expiringWithin90Days: number } {
    const now = new Date();
    const in90 = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    let totalCost = 0, totalUsers = 0, unusedLicenses = 0, expiringWithin90Days = 0;
    for (const l of this.licenses) {
      totalCost += l.costPerMonth;
      totalUsers += l.usedLicenses;
      unusedLicenses += (l.totalLicenses - l.usedLicenses);
      if (new Date(l.expirationDate) <= in90) expiringWithin90Days++;
    }
    return { totalCost, totalUsers, unusedLicenses, expiringWithin90Days };
  }

  getLicenseByTool(toolId: string): LicenseRecord | undefined {
    return this.licenses.find(l => l.toolId === toolId);
  }
}
