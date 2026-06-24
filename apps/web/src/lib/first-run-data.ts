/**
 * Guided First-Run — "Experience the magic" flow
 *
 * An ordered, hand-held arc that walks a brand-new EAOS user from a cold start
 * to their first successful skill run. Unlike the spotlight TOUR_STEPS (see
 * tour-data.ts), these steps drive navigation: each step may carry a `section`
 * (an activeSection id consumed by useEAOSStore.setActiveSection) and an
 * `anchor` (a data-tour target the integrator can highlight).
 *
 * Arc: welcome → connect an LLM key → open the Skill Library → run a skill → celebrate.
 */

export interface FirstRunStep {
    id: string;
    title: string;
    body: string;
    /** activeSection id to navigate to when this step opens (e.g. 'conn-ai-models'). */
    section?: string;
    /** data-tour target this step relates to, for optional highlighting. */
    anchor?: string;
    /** Label for the primary advance button on this step. */
    cta?: string;
}

export const FIRST_RUN_STEPS: FirstRunStep[] = [
    {
        id: 'welcome',
        title: 'Welcome to EAOS ⚡',
        body: 'This is your Enterprise Agent Operating System — where every team finds skills, agents, and tools in one place. In the next minute we\'ll connect a model, open the Skill Library, and run your first skill together. Ready to experience the magic?',
        section: 'home',
        anchor: 'sidebar-logo',
        cta: 'Let\'s go',
    },
    {
        id: 'connect-llm',
        title: 'Step 1 — Connect an AI model',
        body: 'Every skill is powered by an LLM. Add an API key for Claude, GPT, or Gemini under AI Models — it\'s stored locally and never leaves your browser. Once a model is connected, agents can start working for you.',
        section: 'conn-ai-models',
        anchor: 'sidebar-tools',
        cta: 'I\'ve connected a model',
    },
    {
        id: 'open-skill-library',
        title: 'Step 2 — Open the Skill Library',
        body: 'Skills are ready-made jobs agents run for you — write a PRD, review a PR, launch a campaign. Browse the library and pick one that matches what you want to get done. Each skill shows its tools, agents, and estimated time before you run.',
        section: 'platform-skills',
        anchor: 'skill-marketplace',
        cta: 'Show me the skills',
    },
    {
        id: 'run-a-skill',
        title: 'Step 3 — Run your first skill',
        body: 'Pick any skill and hit Run. Agents orchestrate the rest — researching, generating, and integrating — while you watch progress live and approve at checkpoints. There\'s no wrong choice here; this is your sandbox.',
        section: 'platform-skills',
        anchor: 'skill-marketplace',
        cta: 'I ran a skill',
    },
    {
        id: 'celebrate',
        title: 'You\'re all set 🎉',
        body: 'That\'s the magic — connect a model, pick a skill, let agents handle the work. Explore persona hubs for Engineering, Product, and Marketing, or type a goal into the Intent Router any time. You can restart this guide from Settings whenever you like.',
        section: 'home',
        anchor: 'sidebar-logo',
        cta: 'Start using EAOS',
    },
];
