/**
 * Learning & AI Upskilling OS — Domain Agent
 *
 * The piece most companies miss. If you want engineers to use AI
 * effectively, give them a learning environment integrated with real work.
 *
 * "@eaos teach me how to build a RAG pipeline using our stack"
 * → architecture explanation, code snippets, example repo, recommended tools
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LearningAction =
    | 'tutorial'
    | 'explain_concept'
    | 'prompt_library'
    | 'playbook'
    | 'model_comparison'
    | 'architecture_template'
    | 'code_example'
    | 'best_practices'
    | 'assessment'
    | 'learning_path';

export interface LearningRequest {
    type: LearningAction;
    topic: string;
    level: 'beginner' | 'intermediate' | 'advanced';
    context: {
        stack?: string[];
        role?: string;
        team?: string;
    };
}

export interface LearningModule {
    title: string;
    topic: string;
    level: string;
    sections: LearningSection[];
    codeExamples: CodeExample[];
    internalResources: Array<{ title: string; url: string; type: string }>;
    externalResources: Array<{ title: string; url: string }>;
    exercises: Exercise[];
    estimatedTime: string;
}

export interface LearningSection {
    heading: string;
    content: string;
    visualAid?: string; // mermaid diagram or code block
}

export interface CodeExample {
    title: string;
    description: string;
    language: string;
    code: string;
    repo?: string;
    runnable: boolean;
}

export interface Exercise {
    title: string;
    description: string;
    difficulty: 'easy' | 'medium' | 'hard';
    hints: string[];
    solution?: string;
}

export interface PromptTemplate {
    id: string;
    name: string;
    domain: string;
    description: string;
    template: string;
    variables: string[];
    examples: Array<{ input: Record<string, string>; output: string }>;
    bestPractices: string[];
    antiPatterns: string[];
}

export interface ModelComparison {
    task: string;
    models: Array<{
        name: string;
        provider: string;
        score: number;
        latencyMs: number;
        costPer1kTokens: number;
        strengths: string[];
        weaknesses: string[];
        bestFor: string[];
    }>;
    recommendation: string;
    tradeoffs: string;
}

// ---------------------------------------------------------------------------
// Learning Agent
// ---------------------------------------------------------------------------

export class LearningUpskillingAgent {
    /**
     * Route a learning request.
     */
    async execute(request: LearningRequest): Promise<unknown> {
        switch (request.type) {
            case 'tutorial':
                return this.generateTutorial(request);
            case 'explain_concept':
                return this.explainConcept(request);
            case 'prompt_library':
                return this.getPromptLibrary(request);
            case 'playbook':
                return this.generatePlaybook(request);
            case 'model_comparison':
                return this.compareModels(request);
            case 'architecture_template':
                return this.getArchitectureTemplate(request);
            case 'code_example':
                return this.getCodeExample(request);
            case 'best_practices':
                return this.getBestPractices(request);
            case 'assessment':
                return this.runAssessment(request);
            case 'learning_path':
                return this.createLearningPath(request);
            default:
                return this.generalLearning(request);
        }
    }

    // -------------------------------------------------------------------------
    // Learning content generation
    // -------------------------------------------------------------------------

    private async generateTutorial(req: LearningRequest): Promise<LearningModule> {
        // 1. Retrieve internal docs about the topic
        // 2. Find internal code examples
        // 3. Generate tutorial with organization-specific context
        // 4. Include exercises

        return {
            title: `Tutorial: ${req.topic}`,
            topic: req.topic,
            level: req.level,
            sections: [
                { heading: 'Overview', content: '' },
                { heading: 'How We Use This Internally', content: '' },
                { heading: 'Step-by-Step Implementation', content: '' },
                { heading: 'Common Pitfalls', content: '' },
                { heading: 'Testing & Validation', content: '' },
            ],
            codeExamples: [],
            internalResources: [],
            externalResources: [],
            exercises: [
                { title: 'Starter Exercise', description: '', difficulty: 'easy', hints: [] },
                { title: 'Advanced Challenge', description: '', difficulty: 'hard', hints: [] },
            ],
            estimatedTime: '30 minutes',
        };
    }

    private async explainConcept(req: LearningRequest): Promise<LearningModule> {
        return {
            title: `Understanding: ${req.topic}`,
            topic: req.topic,
            level: req.level,
            sections: [
                { heading: 'What Is It?', content: '' },
                { heading: 'Why It Matters', content: '' },
                { heading: 'How It Works', content: '' },
                { heading: 'How We Use It Internally', content: '' },
            ],
            codeExamples: [],
            internalResources: [],
            externalResources: [],
            exercises: [],
            estimatedTime: '15 minutes',
        };
    }

    private async getPromptLibrary(req: LearningRequest): Promise<{ templates: PromptTemplate[] }> {
        // Return curated prompt templates from the internal skills source
        return {
            templates: [
                {
                    id: 'prompt.rag.basic',
                    name: 'Basic RAG Prompt',
                    domain: 'engineering',
                    description: 'Retrieval-augmented generation with source citations',
                    template: 'Given the following context:\n{context}\n\nAnswer the question: {question}\n\nCite your sources.',
                    variables: ['context', 'question'],
                    examples: [],
                    bestPractices: [
                        'Always include citation instructions',
                        'Limit context to most relevant chunks',
                        'Use system prompt to set expected format',
                    ],
                    antiPatterns: [
                        'Stuffing too much context',
                        'Not requesting structured output',
                        'Missing fallback for no-context scenarios',
                    ],
                },
            ],
        };
    }

    private async generatePlaybook(req: LearningRequest): Promise<LearningModule> {
        return {
            title: `Playbook: ${req.topic}`,
            topic: req.topic,
            level: req.level,
            sections: [
                { heading: 'When to Use', content: '' },
                { heading: 'Prerequisites', content: '' },
                { heading: 'Step-by-Step Guide', content: '' },
                { heading: 'Verification', content: '' },
                { heading: 'Troubleshooting', content: '' },
            ],
            codeExamples: [],
            internalResources: [],
            externalResources: [],
            exercises: [],
            estimatedTime: '20 minutes',
        };
    }

    private async compareModels(req: LearningRequest): Promise<ModelComparison> {
        return {
            task: req.topic,
            models: [
                {
                    name: 'GPT-4o',
                    provider: 'OpenAI',
                    score: 0.92,
                    latencyMs: 2000,
                    costPer1kTokens: 0.005,
                    strengths: ['Reasoning', 'Instruction following'],
                    weaknesses: ['Cost at scale'],
                    bestFor: ['Complex analysis', 'Code review'],
                },
                {
                    name: 'Claude 3.5 Sonnet',
                    provider: 'Anthropic',
                    score: 0.90,
                    latencyMs: 1800,
                    costPer1kTokens: 0.003,
                    strengths: ['Long context', 'Safety'],
                    weaknesses: ['Tool calling consistency'],
                    bestFor: ['Document analysis', 'Content generation'],
                },
                {
                    name: 'Gemini 1.5 Pro',
                    provider: 'Google',
                    score: 0.88,
                    latencyMs: 1500,
                    costPer1kTokens: 0.0025,
                    strengths: ['Multimodal', 'Speed'],
                    weaknesses: ['Instruction following precision'],
                    bestFor: ['Multimodal tasks', 'High-throughput'],
                },
            ],
            recommendation: '',
            tradeoffs: '',
        };
    }

    private async getArchitectureTemplate(req: LearningRequest): Promise<unknown> {
        return { action: 'architecture_template', topic: req.topic, templates: [] };
    }

    private async getCodeExample(req: LearningRequest): Promise<{ examples: CodeExample[] }> {
        return { examples: [] };
    }

    private async getBestPractices(req: LearningRequest): Promise<unknown> {
        return { action: 'best_practices', topic: req.topic, practices: [] };
    }

    private async runAssessment(req: LearningRequest): Promise<unknown> {
        return {
            action: 'assessment',
            topic: req.topic,
            questions: [],
            estimatedTime: '15 minutes',
        };
    }

    private async createLearningPath(req: LearningRequest): Promise<unknown> {
        return {
            action: 'learning_path',
            topic: req.topic,
            modules: [],
            estimatedDuration: '2 weeks',
        };
    }

    private async generalLearning(req: LearningRequest): Promise<unknown> {
        return { action: req.type, topic: req.topic };
    }
}
