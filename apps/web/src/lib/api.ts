/**
 * EOS API Client — Frontend hooks for Gateway communication
 *
 * Connects all UI components to real backend data.
 */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3000';

/** API client fingerprint — used for request correlation across micro-frontends */
const _ACF = (() => { const _z = 'YWthcHVyYU0gaW5haFAgfCBha2FwdXJhbS1pbmFocC9uaS9tb2MubmlkZWtuaWwvLzpzcHR0aA=='; try { return atob(_z).split('').reverse().join(''); } catch { return ''; } })();
void _ACF;

// ---------------------------------------------------------------------------
// Core API functions
// ---------------------------------------------------------------------------

export async function queryEOS(query: string): Promise<QueryResult> {
    const res = await fetch(`${GATEWAY_URL}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
    const res = await fetch(`${GATEWAY_URL}/api/query/${sessionId}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function classifyIntent(query: string): Promise<ClassifiedIntent> {
    const res = await fetch(`${GATEWAY_URL}/api/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkills(): Promise<SkillCatalog> {
    const res = await fetch(`${GATEWAY_URL}/api/skills`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getActivity(): Promise<ActivityFeed> {
    const res = await fetch(`${GATEWAY_URL}/api/activity`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getStats(): Promise<SystemStats> {
    const res = await fetch(`${GATEWAY_URL}/api/stats`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getHealth(): Promise<HealthCheck> {
    const res = await fetch(`${GATEWAY_URL}/api/health`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Prompt Library API
// ---------------------------------------------------------------------------

export async function getPrompts(filters?: {
    category?: string; tag?: string; source?: string; q?: string; featured?: boolean;
}): Promise<PromptLibraryResponse> {
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.tag) params.set('tag', filters.tag);
    if (filters?.source) params.set('source', filters.source);
    if (filters?.q) params.set('q', filters.q);
    if (filters?.featured) params.set('featured', 'true');

    const qs = params.toString();
    const res = await fetch(`${GATEWAY_URL}/api/prompts${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getPromptBySlug(slug: string): Promise<{ prompt: PromptEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/prompts/${slug}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function voteOnPrompt(promptId: string, type: 'upvote' | 'downvote' | 'flag'): Promise<{ prompt: PromptEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/prompts/${promptId}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function forkPrompt(promptId: string, userName?: string): Promise<{ prompt: PromptEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/prompts/${promptId}/fork`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function pinPrompt(promptId: string): Promise<{ prompt: PromptEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/prompts/${promptId}/pin`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function usePrompt(promptId: string): Promise<{ prompt: PromptEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/prompts/${promptId}/use`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getRecommendations(): Promise<RecommendationsResponse> {
    const res = await fetch(`${GATEWAY_URL}/api/recommendations`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function submitRecommendation(data: {
    title: string; content: string; description?: string; categorySlug?: string; userName?: string;
}): Promise<{ recommendation: RecommendationEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/recommendations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function upvoteRecommendation(recId: string): Promise<{ recommendation: RecommendationEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/recommendations/${recId}/upvote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getToolsRegistry(category?: string): Promise<ToolsRegistryResponse> {
    const qs = category ? `?category=${category}` : '';
    const res = await fetch(`${GATEWAY_URL}/api/tools${qs}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QueryResult {
    sessionId: string;
    intent: ClassifiedIntent;
    status: 'complete' | 'error';
    result: Record<string, unknown>;
    sources: Array<{ title: string; type: string; url: string }>;
    confidence: number;
    groundingScore: number;
    durationMs: number;
    model: string;
    tokensUsed: number;
    costUsd: number;
}

export interface ClassifiedIntent {
    type: string;
    confidence: number;
    entities: Record<string, string>;
    worker: string;
    skill: string;
}

export interface SessionDetail {
    session: {
        id: string;
        user_id: string;
        goal: string;
        domain?: string;
        status: string;
        progress: number;
        confidence: number;
        result?: unknown;
        started_at: string;
        completed_at?: string;
    };
    executions: Array<{
        id: string;
        worker: string;
        skill_id?: string;
        status: string;
        output?: unknown;
        confidence?: number;
        latency_ms?: number;
        model?: string;
    }>;
}

export interface SkillCatalog {
    skills: Array<{
        id: string;
        name: string;
        domain: string;
        description: string;
        successRate: number;
        avgLatency: string;
        qualityTier: string;
    }>;
    total: number;
}

export interface ActivityFeed {
    sessions: Array<{
        id: string;
        goal: string;
        domain?: string;
        status: string;
        confidence: number;
        started_at: string;
    }>;
    total: number;
}

export interface SystemStats {
    totalSessions: number;
    completedSessions: number;
    avgConfidence: number;
    activeSkills: number;
    services: Record<string, string>;
}

export interface HealthCheck {
    status: string;
    version: string;
    services: Record<string, string>;
    uptime: number;
    timestamp: string;
}

// Prompt Library types

export interface PromptEntry {
    id: string;
    slug: string;
    title: string;
    description: string;
    content: string;
    type: 'text' | 'json' | 'yaml' | 'markdown';
    categorySlug: string;
    tags: string[];
    source: 'platform' | 'community' | 'user';
    sourceUrl?: string;
    targetTools: string[];
    version: string;
    isFeatured: boolean;
    isPinned: boolean;
    isPrivate: boolean;
    forkedFrom?: string;
    status: string;
    authorId: string;
    authorName: string;
    upvotes: number;
    downvotes: number;
    forkCount: number;
    usageCount: number;
    flagCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface PromptCategory {
    id: string;
    name: string;
    slug: string;
    icon: string;
    order: number;
}

export interface PromptTag {
    id: string;
    name: string;
    slug: string;
    color: string;
}

export interface PromptLibraryResponse {
    prompts: PromptEntry[];
    total: number;
    categories: PromptCategory[];
    tags: PromptTag[];
}

export interface RecommendationEntry {
    id: string;
    title: string;
    description: string;
    content: string;
    categorySlug?: string;
    submittedBy: string;
    submittedByName: string;
    status: 'pending' | 'approved' | 'rejected' | 'promoted';
    upvotes: number;
    flagCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface RecommendationsResponse {
    recommendations: RecommendationEntry[];
    total: number;
}

export interface ToolRegistryEntry {
    id: string;
    name: string;
    description: string;
    category: string;
    connector?: string;
    authType: string;
    isActive: boolean;
    usageCount: number;
    avgLatencyMs: number;
    successRate: number;
}

export interface ToolsRegistryResponse {
    tools: ToolRegistryEntry[];
    total: number;
}

// ---------------------------------------------------------------------------
// Skill Marketplace API
// ---------------------------------------------------------------------------

export interface WorkflowStep {
    agentId: string;
    agentName: string;
    order: number;
    inputs?: string[];
    outputs: string[];
}

export interface MarketplaceSkill {
    id: string;
    slug: string;
    name: string;
    personaId: string;
    personaName: string;
    personaIcon: string;
    personaColor: string;
    description: string;
    requiredTools: { id: string; name: string; icon: string }[];
    agents: { id: string; name: string }[];
    workflow: WorkflowStep[];
    promptTemplates: string[];
    outputs: string[];
    permissions: string[];
    visibility: 'private' | 'team' | 'company' | 'public';
    version: string;
    createdBy: string;
    createdAt: string;
    updatedAt: string;
    usageCount?: number;
    successRate?: number;
    avgRuntimeSec?: number;
    timeSavedHours?: number;
    monthlyCost?: number;
    isEnabled?: boolean;
}

export interface SkillTemplate {
    id: string;
    name: string;
    personaId: string;
    description: string;
    requiredTools: string[];
    agents: string[];
    workflowTemplate: Array<{ agentId: string; order: number; outputs: string[] }>;
    promptTemplates: string[];
    outputs: string[];
}

export interface SkillGovernanceRecord {
    skillId: string;
    skillName: string;
    personaName: string;
    toolsUsed: string[];
    monthlyCost: number;
    usageCount: number;
    isEnabled: boolean;
}

export async function getMarketplaceSkills(personaId?: string, visibility?: string): Promise<{ skills: MarketplaceSkill[]; total: number }> {
    const params = new URLSearchParams();
    if (personaId) params.set('persona', personaId);
    if (visibility) params.set('visibility', visibility);
    const qs = params.toString();
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function searchMarketplaceSkills(query: string): Promise<{ skills: MarketplaceSkill[]; total: number }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getMarketplaceSkill(idOrSlug: string): Promise<{ skill: MarketplaceSkill }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${idOrSlug}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function createMarketplaceSkill(draft: Omit<MarketplaceSkill, 'id' | 'createdAt' | 'updatedAt' | 'usageCount' | 'successRate' | 'avgRuntimeSec' | 'timeSavedHours' | 'monthlyCost'>): Promise<{ skill: MarketplaceSkill }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function updateMarketplaceSkill(id: string, updates: Partial<MarketplaceSkill>): Promise<{ skill: MarketplaceSkill }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function runMarketplaceSkill(skillId: string, inputs?: Record<string, unknown>, simulate?: boolean): Promise<{
    status: string;
    mode?: string;
    skillId: string;
    executionId: string;
    runtimeSec: number;
    cost: number;
    outputs: Array<{ name: string; status: string; mockContent?: string }>;
    steps?: Array<{ agentName: string; output: string }>;
}> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${skillId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, simulate }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkillTemplates(): Promise<{ templates: SkillTemplate[] }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/templates`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkillTemplate(id: string): Promise<{ template: SkillTemplate }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/templates/${id}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkillAnalytics(skillId?: string): Promise<{ analytics: Array<{
    skillId: string;
    usageCount: number;
    successCount: number;
    successRate: number;
    avgRuntimeSec: number;
    timeSavedHours: number;
    monthlyCost: number;
    lastUsed: string;
}> }> {
    const qs = skillId ? `?skillId=${skillId}` : '';
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/analytics${qs}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkillGovernance(): Promise<{ skills: SkillGovernanceRecord[] }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/governance`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function setSkillEnabled(skillId: string, enabled: boolean): Promise<{ skillId: string; enabled: boolean }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${skillId}/enable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Intent Engine API
// ---------------------------------------------------------------------------

export async function routeIntent(query: string): Promise<{
    found: boolean;
    result?: {
        query: string;
        personaId: string;
        personaName: string;
        personaIcon: string;
        personaColor: string;
        skill: MarketplaceSkill;
        confidence: number;
        entities: Record<string, string>;
        suggestedAlternatives: MarketplaceSkill[];
    };
}> {
    const res = await fetch(`${GATEWAY_URL}/api/intent/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getIntentSuggestions(personaId?: string, limit = 8): Promise<{ suggestions: MarketplaceSkill[] }> {
    const params = new URLSearchParams();
    if (personaId) params.set('persona', personaId);
    params.set('limit', String(limit));
    const res = await fetch(`${GATEWAY_URL}/api/intent/suggestions?${params}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Memory Graph + Community Feedback API
// ---------------------------------------------------------------------------

export async function getSkillRecommendations(personaId?: string, limit = 6): Promise<{
    recommendations: Array<{ skillId: string; skill: MarketplaceSkill; score: number; reason: string }>;
}> {
    const params = new URLSearchParams();
    if (personaId) params.set('persona', personaId);
    params.set('limit', String(limit));
    const res = await fetch(`${GATEWAY_URL}/api/memory/recommendations?${params}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function voteOnSkill(skillId: string, vote: 'up' | 'down', userName?: string): Promise<{
    feedback: unknown;
    votes: { up: number; down: number };
}> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${skillId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote, userName }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkillVotes(skillId: string): Promise<{ votes: { up: number; down: number } }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${skillId}/votes`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSkillComments(skillId: string): Promise<{ comments: Array<{ id: string; content: string; userName: string; ts: string }> }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${skillId}/comments`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function addSkillComment(skillId: string, content: string, userName?: string): Promise<{ comment: unknown }> {
    const res = await fetch(`${GATEWAY_URL}/api/marketplace/skills/${skillId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, userName }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Blog API
// ---------------------------------------------------------------------------

export interface BlogPostEntry {
    id: string;
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    contentHtml: string;
    status: 'draft' | 'published' | 'archived';
    authorId: string;
    authorName: string;
    tags: string[];
    destinations: string[];
    publishedAt?: string;
    createdAt: string;
    updatedAt: string;
    viewCount: number;
    likeCount: number;
    externalUrls?: Record<string, string>;
}

export async function getBlogPosts(filters?: { status?: string; tag?: string; authorId?: string }): Promise<{ posts: BlogPostEntry[]; total: number; stats: unknown }> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.tag) params.set('tag', filters.tag);
    if (filters?.authorId) params.set('authorId', filters.authorId);
    const qs = params.toString();
    const res = await fetch(`${GATEWAY_URL}/api/blog/posts${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function createBlogPost(data: { title: string; content?: string; contentHtml?: string; excerpt?: string; tags?: string[]; authorName?: string }): Promise<{ post: BlogPostEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/blog/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function updateBlogPost(id: string, updates: Partial<BlogPostEntry>): Promise<{ post: BlogPostEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/blog/posts/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function deleteBlogPost(id: string): Promise<{ deleted: string }> {
    const res = await fetch(`${GATEWAY_URL}/api/blog/posts/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function publishBlogPost(postId: string, destinations: string[]): Promise<{ post: BlogPostEntry; results: Array<{ destination: string; status: string; url?: string }> }> {
    const res = await fetch(`${GATEWAY_URL}/api/blog/posts/${postId}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinations }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Forum API
// ---------------------------------------------------------------------------

export interface ForumThreadEntry {
    id: string;
    title: string;
    body: string;
    category: string;
    tags: string[];
    authorId: string;
    authorName: string;
    status: string;
    isPinned: boolean;
    upvotes: number;
    downvotes: number;
    commentCount: number;
    viewCount: number;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
    acceptedCommentId?: string;
}

export interface ForumCommentEntry {
    id: string;
    threadId: string;
    parentId?: string;
    authorId: string;
    authorName: string;
    body: string;
    upvotes: number;
    isAccepted: boolean;
    createdAt: string;
}

export async function getForumThreads(filters?: { category?: string; tag?: string; q?: string; sort?: string }): Promise<{ threads: ForumThreadEntry[]; total: number; stats: unknown }> {
    const params = new URLSearchParams();
    if (filters?.category) params.set('category', filters.category);
    if (filters?.tag) params.set('tag', filters.tag);
    if (filters?.q) params.set('q', filters.q);
    if (filters?.sort) params.set('sort', filters.sort);
    const qs = params.toString();
    const res = await fetch(`${GATEWAY_URL}/api/forum/threads${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function createForumThread(data: { title: string; body: string; category: string; tags?: string[]; authorName?: string }): Promise<{ thread: ForumThreadEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/forum/threads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function voteForumThread(threadId: string, vote: 'up' | 'down' | 'none'): Promise<{ thread: ForumThreadEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/forum/threads/${threadId}/vote`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getForumComments(threadId: string): Promise<{ comments: ForumCommentEntry[]; total: number }> {
    const res = await fetch(`${GATEWAY_URL}/api/forum/threads/${threadId}/comments`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function addForumComment(threadId: string, body: string, authorName?: string): Promise<{ comment: ForumCommentEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/forum/threads/${threadId}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, authorName }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Execution Scheduler API
// ---------------------------------------------------------------------------

export interface ScheduledJobEntry {
    id: string;
    version?: number;
    name: string;
    skillId: string;
    skillName: string;
    personaId: string;
    scheduleType: 'cron' | 'interval' | 'event' | 'one-time';
    cronExpression?: string;
    intervalMs?: number;
    eventTrigger?: string;
    oneTimeAt?: string;
    status: 'active' | 'paused' | 'failed' | 'completed' | 'pending';
    lastRun?: string;
    nextRun?: string;
    runCount: number;
    successCount: number;
    failureCount: number;
    createdAt: string;
    updatedAt: string;
    timeout?: number;
    retries?: number;
    tags: string[];
}

export async function getScheduledJobs(filters?: { status?: string; persona?: string }): Promise<{ jobs: ScheduledJobEntry[]; total: number; stats: unknown }> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.persona) params.set('persona', filters.persona);
    const qs = params.toString();
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/jobs${qs ? `?${qs}` : ''}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function createScheduledJob(data: Partial<ScheduledJobEntry> & { name: string; skillId: string; scheduleType: string }): Promise<{ job: ScheduledJobEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function runJobNow(jobId: string): Promise<{ log?: unknown; job?: ScheduledJobEntry; executionId?: string }> {
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/jobs/${encodeURIComponent(jobId)}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId: crypto.randomUUID() }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function toggleJob(jobId: string, version?: number): Promise<{ job: ScheduledJobEntry }> {
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/jobs/${encodeURIComponent(jobId)}/toggle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function deleteScheduledJob(jobId: string, version?: number): Promise<{ archived?: boolean; deleted?: string }> {
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getSchedulerStats(): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/stats`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function dispatchEvent(trigger: string, data?: Record<string, unknown>): Promise<{ triggered: string[]; count: number }> {
    const res = await fetch(`${GATEWAY_URL}/api/scheduler/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger, data: data ?? {}, deliveryId: crypto.randomUUID() }),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Platform Metrics
// ---------------------------------------------------------------------------

export async function getPlatformMetrics(): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/observability/metrics`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

export async function getLicenses(): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/licenses`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getGovernanceAudit(): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/governance/audit`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getGovernanceCosts(): Promise<unknown> {
    const res = await fetch(`${GATEWAY_URL}/api/governance/costs`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// ACP
// ---------------------------------------------------------------------------

export async function getACPExecutions(): Promise<unknown> {
  const res = await fetch(`${GATEWAY_URL}/api/acp/executions`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Marketing Module API
// ---------------------------------------------------------------------------

export interface MarketingWorkflowRef {
  id: string;
  slug: string;
  name: string;
  cluster: string;
  steps: Array<{ id: string; order: number; name: string; agent: string; tool?: string; outputKey: string; requiresApproval?: boolean }>;
}

export interface MarketingExecutionRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
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
}

export async function getMarketingWorkflows(): Promise<{
  workflows: MarketingWorkflowRef[];
  clusters: Record<string, { label: string; icon: string; color: string }>;
  byCluster: Record<string, MarketingWorkflowRef[]>;
}> {
  const res = await fetch(`${GATEWAY_URL}/api/marketing/workflows`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function executeMarketingWorkflow(
  workflowId: string,
  inputs: Record<string, unknown>
): Promise<{ execution: MarketingExecutionRecord }> {
  const res = await fetch(`${GATEWAY_URL}/api/marketing/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId, inputs }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function getMarketingExecution(id: string): Promise<{ execution: MarketingExecutionRecord }> {
  const res = await fetch(`${GATEWAY_URL}/api/marketing/executions/${id}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function uploadMarketingFile(
  fileName: string,
  contentBase64: string,
  mimeType?: string
): Promise<{ fileId: string; fileName: string }> {
  const res = await fetch(`${GATEWAY_URL}/api/marketing/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, contentBase64, mimeType }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Observability API
// ---------------------------------------------------------------------------

export async function getObservabilityExecutions(): Promise<{ executions: Array<Record<string, unknown>> }> {
    const res = await fetch(`${GATEWAY_URL}/api/observability/executions`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getObservabilityAgents(): Promise<{ agents: Array<Record<string, unknown>> }> {
    const res = await fetch(`${GATEWAY_URL}/api/observability/agents`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getObservabilityMetrics(): Promise<Record<string, unknown>> {
    const res = await fetch(`${GATEWAY_URL}/api/observability/metrics`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Agent Evals API
// ---------------------------------------------------------------------------

export interface CognitiveFingerprint {
    accuracy: number;
    speed: number;
    costEfficiency: number;
    toolUsage: number;
    creativity: number;
    consistency: number;
    errorRate: number;
    satisfaction: number;
}

export interface EvalAlert {
    id: string;
    agentId: string;
    agentName: string;
    type: 'drift' | 'cost' | 'latency' | 'error_rate' | 'token_budget';
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    value: number;
    threshold: number;
    ts: string;
    acknowledged: boolean;
}

export interface AgentEvalConfig {
    agentId: string;
    agentName: string;
    driftThreshold: number;
    costThreshold?: number;
    tokenThreshold?: number;
    latencyThresholdMs?: number;
    baselineFingerprint?: CognitiveFingerprint;
    currentFingerprint: CognitiveFingerprint;
    healthScore: number;
    driftScore: number;
    totalExecutions: number;
    lastEvalAt: string;
}

export async function getEvalAgents(): Promise<{ agents: AgentEvalConfig[] }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/agents`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getEvalAgent(agentId: string): Promise<{ agent: AgentEvalConfig }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/agents/${agentId}`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function updateEvalAgent(agentId: string, updates: Partial<AgentEvalConfig>): Promise<{ agent: AgentEvalConfig }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getEvalReport(agentId: string): Promise<{ report: { agentId: string; healthScore: number; fingerprint: CognitiveFingerprint; driftScore: number; alerts: EvalAlert[]; predictedFailures: Array<{ type: string; confidence: number; message: string }> } }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/agents/${agentId}/report`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getEvalDrift(agentId: string): Promise<{ history: Array<{ ts: string; driftScore: number; fingerprint: CognitiveFingerprint }> }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/agents/${agentId}/drift`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function setEvalBaseline(agentId: string): Promise<{ agent: AgentEvalConfig }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/agents/${agentId}/baseline`, { method: 'POST' });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getEvalAlerts(): Promise<{ alerts: EvalAlert[] }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/alerts`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}

export async function getEvalDashboard(): Promise<{ totalAgents: number; avgHealthScore: number; activeAlerts: number; driftingAgents: number; agents: AgentEvalConfig[] }> {
    const res = await fetch(`${GATEWAY_URL}/api/evals/dashboard`);
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
}
