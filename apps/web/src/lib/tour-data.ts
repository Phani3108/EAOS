/**
 * Guided Tour — Persona-first AgentOS tour
 *
 * Each step targets a data-tour attribute on a DOM element.
 */

export interface TourStep {
    id: string;
    title: string;
    description: string;
    target: string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    exampleInput?: string;
    expectedOutput?: string;
}

export const TOUR_STEPS: TourStep[] = [
    {
        id: 'sidebar-logo',
        title: 'Welcome to AgentOS',
        description: 'Your Enterprise Operating System — a persona-first platform where every team finds skills, agents, and tools in one place. Think of it as the OS for enterprise work.',
        target: 'sidebar-logo',
        placement: 'bottom',
    },
    {
        id: 'top-nav',
        title: 'Navigation',
        description: 'Use the top navigation to switch between Personas & Skills, Agents, Workflows, Tools, and more. The platform is organized around what you want to do, not how the system works.',
        target: 'sidebar',
        placement: 'bottom',
    },
    {
        id: 'intent-router',
        title: 'Intent Router — What do you want to do?',
        description: 'Type your goal in natural language. AgentOS detects your persona, selects the best skill, and shows agents + tools. Example: "Create PRD for AI feature" or "Launch LinkedIn campaign". Click Run to execute.',
        target: 'intent-router',
        placement: 'bottom',
        exampleInput: 'Create PRD for AI incident assistant',
        expectedOutput: 'Persona: Product → Skill: PRD Generator → Run',
    },
    {
        id: 'persona-selector',
        title: 'Persona Selector',
        description: 'Choose your role — Product, Engineering, Marketing, HR, Finance, and more. Each persona has tailored skills, agents, tools, and courses. Start here to find the exact skill you need.',
        target: 'persona-selector',
        placement: 'right',
    },
    {
        id: 'skills-dashboard',
        title: 'Skills Dashboard',
        description: 'Browse skills organized by category. Each skill shows complexity, estimated time, and outputs. Click "Run" to execute a skill — agents will handle the rest.',
        target: 'skills-dashboard',
        placement: 'left',
        exampleInput: 'Product Manager → Write PRD',
        expectedOutput: 'PRD document, User stories, Jira epics',
    },
    {
        id: 'skill-execution',
        title: 'Execution Panel',
        description: 'Watch agents execute your skill in real-time. Each agent handles a specific step — research, generation, integration. You see progress, outputs, and can approve at checkpoints.',
        target: 'skill-execution',
        placement: 'left',
    },
    {
        id: 'license-governance',
        title: 'License Governance (Corp IT)',
        description: 'Corp IT gets a dedicated license governance dashboard showing tool usage, costs, unused licenses, and upcoming renewals. Manage access, optimize spending, and track adoption.',
        target: 'license-governance',
        placement: 'top',
    },
    // ── Navigation ──
    {
        id: 'sidebar-agents',
        title: 'Agents',
        description: 'View all autonomous AI agents — each specialized for a function like code review, campaign planning, or ticket triage. Agents are deployed by skills automatically.',
        target: 'sidebar-platform-agents',
        placement: 'bottom',
    },
    {
        id: 'sidebar-workflows',
        title: 'Workflows',
        description: 'Visual DAG-based pipelines that chain agents and tools together. Build repeatable multi-step processes for any department.',
        target: 'sidebar-platform-workflows',
        placement: 'bottom',
    },
    {
        id: 'skill-marketplace',
        title: 'Skill Marketplace',
        description: 'Browse and run skills by persona. Upvote or downvote skills. Each skill shows tools, agents, runtime, and popularity. Run skills with one click — agents orchestrate the rest.',
        target: 'skill-marketplace',
        placement: 'left',
    },
    {
        id: 'sidebar-tools',
        title: 'Tools & Marketplace',
        description: 'Connect enterprise tools via OAuth, API keys, or MCP. Each tool advertises capabilities so agents can dynamically select the best tool for each step.',
        target: 'sidebar-ops-integrations',
        placement: 'bottom',
    },
    {
        id: 'sidebar-prompts',
        title: 'Prompt Library',
        description: 'Browse, search, and fork curated AI prompts. Upvote, flag, pin, or duplicate prompts for your own use.',
        target: 'prompt-library',
        placement: 'bottom',
    },
    {
        id: 'sidebar-knowledge',
        title: 'Knowledge',
        description: 'Search across all internal knowledge — Confluence, GitHub, Jira, and more. Results ranked by relevance with source attribution.',
        target: 'command-palette',
        placement: 'bottom',
    },
    {
        id: 'sidebar-learning',
        title: 'Learning Hub',
        description: '10 AI learning platforms, 24 curated courses, and a 5-day agent development roadmap. Track AI adoption across the organization.',
        target: 'ai-courses-hub',
        placement: 'bottom',
    },
    // ── Persona Hubs ──
    {
        id: 'sidebar-engineering',
        title: 'Engineering Hub',
        description: 'AI-powered engineering assistant with 10 specialized skills — PR reviews, unit test generation, CI failure diagnosis, incident RCA drafts, and more. All backed by Claude + GitHub + Jira.',
        target: 'sidebar-ws-engineering',
        placement: 'right',
        exampleInput: 'Pick "PR Review Assistant" → paste a PR URL → Run',
        expectedOutput: 'AI code review with severity-ranked findings and suggested fixes',
    },
    {
        id: 'eng-command-center',
        title: 'Engineering Command Center',
        description: 'Select a skill from 4 clusters: Code Review, Code Generation, Incident Response, and Documentation. Each skill shows its step pipeline, required tools, and estimated time before you run.',
        target: 'sidebar-ws-engineering',
        placement: 'right',
    },
    {
        id: 'eng-skill-form',
        title: 'Smart Skill Forms',
        description: 'Forms adapt to the skill — multiselect focus areas, severity thresholds, file attachments, and conditional fields that appear only when relevant (e.g. "Post back to PR" appears only when "Include fixes" is on). Choose Live or Sandbox mode.',
        target: 'sidebar-ws-engineering',
        placement: 'right',
        exampleInput: 'Review Focus: Security + Performance | Severity: High only',
        expectedOutput: 'Filtered review focusing on critical security and performance issues',
    },
    {
        id: 'sidebar-product',
        title: 'Product Hub',
        description: 'AI product management assistant with 10 skills — PRD generation, Jira epic creation, user story writing, roadmap building, and competitor analysis. Connected to Jira, Confluence, Notion, and Perplexity.',
        target: 'sidebar-ws-product',
        placement: 'right',
        exampleInput: 'Feature: AI-powered search | Goal: reduce time-to-answer by 40%',
        expectedOutput: 'Full PRD + acceptance criteria + Jira epics pushed automatically',
    },
    {
        id: 'prod-skill-form',
        title: 'Product Skill Forms',
        description: 'Rich input forms with tags fields (success metrics, constraints, stakeholders), toggles to push directly to Jira or create Confluence drafts, and a run mode selector. Advanced fields collapse until needed.',
        target: 'sidebar-ws-product',
        placement: 'right',
        exampleInput: 'Success Metrics: DAU +20%, P95 latency < 200ms | Push to Jira: ON',
        expectedOutput: 'Epics created in Jira with structured acceptance criteria',
    },
    {
        id: 'persona-tool-strip',
        title: 'Connected Tool Strip',
        description: 'Every skill form shows which tools are required and whether they\'re connected — Claude is always available, optional tools (GitHub, Jira, Confluence) show grey until credentials are added in Integrations.',
        target: 'sidebar-ws-engineering',
        placement: 'right',
    },
    {
        id: 'tour-complete',
        title: 'You\'re Ready!',
        description: 'Select a persona, pick a skill, and let agents handle the rest. Engineering Hub for code-related tasks, Product Hub for planning and documentation, Marketing Hub for campaigns. Restart this tour anytime from Settings.',
        target: 'sidebar-logo',
        placement: 'bottom',
    },
];
