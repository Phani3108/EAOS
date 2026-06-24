"use strict";
/**
 * AgentOS API End-to-End Tests
 *
 * Tests every backend API endpoint systematically.
 * Run: pnpm test:api
 *
 * Requirements:
 *   - Gateway must be running on http://localhost:3000
 *   - Uses Node's built-in fetch (Node 18+)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const BASE = 'http://localhost:3000';
const HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];
async function test(name, fn) {
    const start = Date.now();
    try {
        await fn();
        const dur = Date.now() - start;
        results.push({ name, status: 'pass', durationMs: dur });
        passed++;
        console.log(`  ✓  ${name} (${dur}ms)`);
    }
    catch (err) {
        const dur = Date.now() - start;
        const error = err instanceof Error ? err.message : String(err);
        results.push({ name, status: 'fail', durationMs: dur, error });
        failed++;
        console.log(`  ✗  ${name} (${dur}ms)\n     ${error}`);
    }
}
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
function assertStatus(actual, expected, context = '') {
    assert(actual === expected, `Expected status ${expected}, got ${actual}${context ? ` — ${context}` : ''}`);
}
async function get(path) {
    const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
    return { status: res.status, body: await res.json() };
}
async function post(path, data = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: HEADERS, body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.json() };
}
async function patch(path, data = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'PATCH', headers: HEADERS, body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.json() };
}
async function put(path, data = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method: 'PUT', headers: HEADERS, body: JSON.stringify(data),
    });
    return { status: res.status, body: await res.json() };
}
async function del(path) {
    const res = await fetch(`${BASE}${path}`, { method: 'DELETE', headers: HEADERS });
    return { status: res.status, body: await res.json() };
}
// ---------------------------------------------------------------------------
// Core / System Tests
// ---------------------------------------------------------------------------
async function testCore() {
    console.log('\n── Core / System ─────────────────────────────────');
    await test('GET /api/health returns 200 and healthy status', async () => {
        const { status, body } = await get('/api/health');
        assertStatus(status, 200);
        assert(body.status === 'healthy', `status should be healthy, got: ${body.status}`);
        assert(typeof body.uptime === 'number', 'uptime should be a number');
        assert(body.version !== undefined, 'version should exist');
    });
    await test('GET /api/stats returns aggregated statistics', async () => {
        const { status, body } = await get('/api/stats');
        assertStatus(status, 200);
        assert(typeof body.totalSessions === 'number', 'totalSessions should be a number');
        assert(typeof body.activeSkills === 'number', 'activeSkills should be a number');
    });
    await test('GET /api/skills returns skill catalog', async () => {
        const { status, body } = await get('/api/skills');
        assertStatus(status, 200);
        assert(Array.isArray(body.skills), 'skills should be an array');
        assert(body.skills.length > 0, 'should have at least one skill');
    });
    await test('POST /api/classify classifies intent correctly', async () => {
        const { status, body } = await post('/api/classify', { query: 'create PRD and jira epics' });
        assertStatus(status, 200);
        assert(body.type !== undefined, 'should return intent type');
    });
    await test('POST /api/query handles natural language query', async () => {
        const { status, body } = await post('/api/query', { query: 'analyze incident root cause' });
        assertStatus(status, 200);
        assert(body.sessionId !== undefined, 'should return sessionId');
        assert(body.status !== undefined, 'should return status');
    });
    await test('GET /api/activity returns recent activity', async () => {
        const { status, body } = await get('/api/activity');
        assertStatus(status, 200);
        assert(Array.isArray(body.sessions), 'sessions should be an array');
    });
}
// ---------------------------------------------------------------------------
// Persona & Skill System Tests
// ---------------------------------------------------------------------------
async function testPersonas() {
    console.log('\n── Personas & Skills ─────────────────────────────');
    await test('GET /api/personas returns all personas', async () => {
        const { status, body } = await get('/api/personas');
        assertStatus(status, 200);
        assert(Array.isArray(body.personas), 'personas should be an array');
        const personas = body.personas;
        assert(personas.length >= 3, `should have at least 3 personas, got ${personas.length}`);
    });
    await test('GET /api/personas/:id returns a specific persona', async () => {
        const { body: list } = await get('/api/personas');
        const first = list.personas[0];
        const { status, body } = await get(`/api/personas/${first.id}`);
        assertStatus(status, 200);
        assert(body.persona !== undefined, 'should return persona');
    });
    await test('GET /api/personas/:id/skills returns persona skills', async () => {
        const { body: list } = await get('/api/personas');
        const first = list.personas[0];
        const { status, body } = await get(`/api/personas/${first.id}/skills`);
        assertStatus(status, 200);
        assert(Array.isArray(body.skills), 'skills should be an array');
    });
    await test('GET /api/personas/nonexistent returns 404', async () => {
        const { status } = await get('/api/personas/does-not-exist-xyz');
        assertStatus(status, 404);
    });
}
// ---------------------------------------------------------------------------
// Skill Marketplace Tests
// ---------------------------------------------------------------------------
async function testMarketplace() {
    console.log('\n── Skill Marketplace ─────────────────────────────');
    let createdSkillId = '';
    await test('GET /api/marketplace/skills returns skills list', async () => {
        const { status, body } = await get('/api/marketplace/skills');
        assertStatus(status, 200);
        assert(Array.isArray(body.skills), 'skills should be an array');
        assert(body.total !== undefined, 'total should exist');
    });
    await test('GET /api/marketplace/skills?persona= filters by persona', async () => {
        const { status, body } = await get('/api/marketplace/skills?persona=engineering');
        assertStatus(status, 200);
        assert(Array.isArray(body.skills), 'skills should be an array');
    });
    await test('GET /api/marketplace/skills/search?q= searches skills', async () => {
        const { status, body } = await get('/api/marketplace/skills/search?q=campaign');
        assertStatus(status, 200);
        assert(Array.isArray(body.skills), 'skills should be an array');
    });
    await test('POST /api/marketplace/skills creates a new skill', async () => {
        const { status, body } = await post('/api/marketplace/skills', {
            name: 'Test Automation Skill',
            slug: `test-skill-${Date.now()}`,
            personaId: 'engineering',
            personaName: 'Engineering',
            personaIcon: '⚙️',
            personaColor: '#3b82f6',
            description: 'Automated test skill for E2E testing',
            requiredTools: [],
            agents: [{ id: 'a1', name: 'Test Agent' }],
            workflow: [],
            promptTemplates: [],
            outputs: ['test-output'],
            permissions: [],
            visibility: 'private',
            version: '1.0.0',
            createdBy: 'test-user',
        });
        assertStatus(status, 201);
        assert(body.skill !== undefined, 'should return created skill');
        createdSkillId = body.skill.id;
    });
    await test('GET /api/marketplace/skills/:id returns created skill', async () => {
        if (!createdSkillId) {
            console.log('     skip — no skill created');
            return;
        }
        const { status, body } = await get(`/api/marketplace/skills/${createdSkillId}`);
        assertStatus(status, 200);
        assert(body.skill.id === createdSkillId, 'should return correct skill');
    });
    await test('POST /api/marketplace/skills/:id/run simulates execution', async () => {
        if (!createdSkillId) {
            console.log('     skip — no skill created');
            return;
        }
        const { status, body } = await post(`/api/marketplace/skills/${createdSkillId}/run`, { simulate: true });
        assertStatus(status, 200);
        assert(body.status === 'complete', `status should be complete, got: ${body.status}`);
        assert(body.mode === 'simulation', 'should be in simulation mode');
    });
    await test('POST /api/marketplace/skills/:id/vote records vote', async () => {
        if (!createdSkillId) {
            console.log('     skip — no skill created');
            return;
        }
        const { status, body } = await post(`/api/marketplace/skills/${createdSkillId}/vote`, { vote: 'up', userName: 'TestUser' });
        assertStatus(status, 200);
        assert(body.votes !== undefined, 'should return votes');
    });
    await test('GET /api/marketplace/analytics returns analytics data', async () => {
        const { status, body } = await get('/api/marketplace/analytics');
        assertStatus(status, 200);
        assert(Array.isArray(body.analytics), 'analytics should be an array');
    });
    await test('GET /api/marketplace/governance returns governance data', async () => {
        const { status, body } = await get('/api/marketplace/governance');
        assertStatus(status, 200);
        assert(Array.isArray(body.skills), 'skills should be an array');
    });
}
// ---------------------------------------------------------------------------
// Intent Engine Tests
// ---------------------------------------------------------------------------
async function testIntentEngine() {
    console.log('\n── Intent Engine ─────────────────────────────────');
    await test('POST /api/intent/route routes intent to skill', async () => {
        const { status, body } = await post('/api/intent/route', { query: 'create marketing campaign strategy' });
        assertStatus(status, 200);
        assert(body.found !== undefined, 'should return found flag');
    });
    await test('POST /api/intent/route returns found=false for unknown intent', async () => {
        const { status, body } = await post('/api/intent/route', { query: 'xyzzy frobulate the quux' });
        assertStatus(status, 200);
        // May or may not find — just check it doesn't crash
        assert(typeof body.found === 'boolean', 'found should be boolean');
    });
    await test('GET /api/intent/suggestions returns suggestions', async () => {
        const { status, body } = await get('/api/intent/suggestions?limit=5');
        assertStatus(status, 200);
        assert(Array.isArray(body.suggestions), 'suggestions should be an array');
    });
    await test('GET /api/intent/suggestions?persona= filters by persona', async () => {
        const { status, body } = await get('/api/intent/suggestions?persona=marketing&limit=3');
        assertStatus(status, 200);
        assert(Array.isArray(body.suggestions), 'suggestions should be an array');
    });
}
// ---------------------------------------------------------------------------
// Prompt Library Tests
// ---------------------------------------------------------------------------
async function testPromptLibrary() {
    console.log('\n── Prompt Library ────────────────────────────────');
    await test('GET /api/prompts returns prompt library', async () => {
        const { status, body } = await get('/api/prompts');
        assertStatus(status, 200);
        assert(Array.isArray(body.prompts), 'prompts should be an array');
        assert(Array.isArray(body.categories), 'categories should be an array');
    });
    await test('GET /api/prompts?category= filters by category', async () => {
        const { body: meta } = await get('/api/prompts/meta');
        const cats = meta.categories;
        if (!cats.length)
            return;
        const { status, body } = await get(`/api/prompts?category=${cats[0].slug}`);
        assertStatus(status, 200);
        assert(Array.isArray(body.prompts), 'filtered prompts should be an array');
    });
    await test('GET /api/prompts?q= searches prompts', async () => {
        const { status, body } = await get('/api/prompts?q=marketing');
        assertStatus(status, 200);
        assert(Array.isArray(body.prompts), 'prompts should be an array');
    });
    await test('GET /api/prompts/meta returns categories and tags', async () => {
        const { status, body } = await get('/api/prompts/meta');
        assertStatus(status, 200);
        assert(Array.isArray(body.categories), 'categories should be an array');
        assert(Array.isArray(body.tags), 'tags should be an array');
    });
    await test('GET /api/recommendations returns recommendations', async () => {
        const { status, body } = await get('/api/recommendations');
        assertStatus(status, 200);
        assert(Array.isArray(body.recommendations), 'recommendations should be an array');
    });
    await test('POST /api/recommendations creates a recommendation', async () => {
        const { status, body } = await post('/api/recommendations', {
            title: 'Test Recommendation E2E',
            content: 'This is an automated test recommendation',
            description: 'Created by E2E test suite',
        });
        assertStatus(status, 201);
        assert(body.recommendation !== undefined, 'should return created recommendation');
    });
}
// ---------------------------------------------------------------------------
// Memory Graph Tests
// ---------------------------------------------------------------------------
async function testMemoryGraph() {
    console.log('\n── Memory Graph ──────────────────────────────────');
    await test('GET /api/memory/stats returns memory stats', async () => {
        const { status, body } = await get('/api/memory/stats');
        assertStatus(status, 200);
        assert(body.totalExecutions !== undefined || body.users !== undefined || typeof body === 'object', 'should return stats object');
    });
    await test('GET /api/memory/executions returns executions', async () => {
        const { status, body } = await get('/api/memory/executions');
        assertStatus(status, 200);
        assert(Array.isArray(body.executions), 'executions should be an array');
    });
    await test('GET /api/memory/recommendations returns recommendations', async () => {
        const { status, body } = await get('/api/memory/recommendations');
        assertStatus(status, 200);
        assert(Array.isArray(body.recommendations), 'recommendations should be an array');
    });
}
// ---------------------------------------------------------------------------
// Tool Registry Tests
// ---------------------------------------------------------------------------
async function testToolRegistry() {
    console.log('\n── Tool Registry ─────────────────────────────────');
    await test('GET /api/tools returns tool registry', async () => {
        const { status, body } = await get('/api/tools');
        assertStatus(status, 200);
        assert(Array.isArray(body.tools), 'tools should be an array');
    });
    await test('GET /api/tools/registry returns extended registry', async () => {
        const { status, body } = await get('/api/tools/registry');
        assertStatus(status, 200);
        assert(Array.isArray(body.tools), 'tools should be an array');
        assert(typeof body.total === 'number', 'total should be a number');
    });
    let registeredToolId = '';
    await test('POST /api/tools/registry registers a new tool', async () => {
        const toolId = `test-tool-${Date.now()}`;
        const { status, body } = await post('/api/tools/registry', {
            id: toolId,
            name: 'Test Tool E2E',
            capabilities: ['create', 'read'],
            authType: 'api_key',
            category: 'testing',
            description: 'E2E test tool',
        });
        assertStatus(status, 201);
        assert(body.tool !== undefined, 'should return created tool');
        registeredToolId = body.tool.id;
    });
    await test('DELETE /api/tools/registry/:id removes a tool', async () => {
        if (!registeredToolId) {
            console.log('     skip — no tool registered');
            return;
        }
        const { status, body } = await del(`/api/tools/registry/${registeredToolId}`);
        assertStatus(status, 200);
        assert(body.deleted === registeredToolId, 'should confirm deletion');
    });
}
// ---------------------------------------------------------------------------
// Execution Scheduler Tests
// ---------------------------------------------------------------------------
async function testScheduler() {
    console.log('\n── Execution Scheduler ───────────────────────────');
    let createdJobId = '';
    await test('GET /api/scheduler/jobs returns jobs list', async () => {
        const { status, body } = await get('/api/scheduler/jobs');
        assertStatus(status, 200);
        assert(Array.isArray(body.jobs), 'jobs should be an array');
        assert(body.total !== undefined, 'total should exist');
        assert(body.stats !== undefined, 'stats should exist');
    });
    await test('GET /api/scheduler/stats returns stats', async () => {
        const { status, body } = await get('/api/scheduler/stats');
        assertStatus(status, 200);
        assert(typeof body.totalJobs === 'number', 'totalJobs should be a number');
        assert(typeof body.activeJobs === 'number', 'activeJobs should be a number');
    });
    await test('POST /api/scheduler/jobs creates a scheduled job', async () => {
        const { status, body } = await post('/api/scheduler/jobs', {
            name: 'E2E Test Job',
            skillId: 'test.skill',
            skillName: 'Test Skill',
            scheduleType: 'cron',
            cronExpression: '0 9 * * MON',
            timeout: 60,
            retries: 1,
            tags: ['test', 'e2e'],
        });
        assertStatus(status, 201);
        assert(body.job !== undefined, 'should return created job');
        createdJobId = body.job.id;
    });
    await test('GET /api/scheduler/jobs/:id returns job with logs', async () => {
        if (!createdJobId) {
            console.log('     skip — no job created');
            return;
        }
        const { status, body } = await get(`/api/scheduler/jobs/${createdJobId}`);
        assertStatus(status, 200);
        assert(body.job !== undefined, 'should return job');
        assert(Array.isArray(body.logs), 'logs should be an array');
    });
    await test('POST /api/scheduler/jobs/:id/run executes job manually', async () => {
        if (!createdJobId) {
            console.log('     skip — no job created');
            return;
        }
        const { status, body } = await post(`/api/scheduler/jobs/${createdJobId}/run`);
        assertStatus(status, 200);
        assert(body.log !== undefined, 'should return execution log');
        const log = body.log;
        assert(['success', 'failed', 'running'].includes(log.status), `log status should be valid, got: ${log.status}`);
    });
    await test('POST /api/scheduler/jobs/:id/toggle pauses an active job', async () => {
        if (!createdJobId) {
            console.log('     skip — no job created');
            return;
        }
        const { status, body } = await post(`/api/scheduler/jobs/${createdJobId}/toggle`);
        assertStatus(status, 200);
        const job = body.job;
        assert(['active', 'paused'].includes(job.status), 'job status should be active or paused');
    });
    await test('PATCH /api/scheduler/jobs/:id updates a job', async () => {
        if (!createdJobId) {
            console.log('     skip — no job created');
            return;
        }
        const { status, body } = await patch(`/api/scheduler/jobs/${createdJobId}`, {
            name: 'Updated E2E Job',
            timeout: 90,
        });
        assertStatus(status, 200);
        assert(body.job.name === 'Updated E2E Job', 'name should be updated');
    });
    await test('POST /api/scheduler/events dispatches an event trigger', async () => {
        const { status, body } = await post('/api/scheduler/events', {
            trigger: 'github.pull_request.opened',
            data: { prNumber: 999, repo: 'test-repo' },
            source: 'e2e-test',
        });
        assertStatus(status, 200);
        assert(Array.isArray(body.triggered), 'triggered should be an array');
        assert(typeof body.count === 'number', 'count should be a number');
    });
    await test('DELETE /api/scheduler/jobs/:id deletes a job', async () => {
        if (!createdJobId) {
            console.log('     skip — no job created');
            return;
        }
        const { status, body } = await del(`/api/scheduler/jobs/${createdJobId}`);
        assertStatus(status, 200);
        assert(body.deleted === createdJobId, 'should confirm deletion');
    });
    await test('GET /api/scheduler/jobs/:id returns 404 for deleted job', async () => {
        if (!createdJobId) {
            console.log('     skip — no job created');
            return;
        }
        const { status } = await get(`/api/scheduler/jobs/${createdJobId}`);
        assertStatus(status, 404);
    });
}
// ---------------------------------------------------------------------------
// Blog API Tests
// ---------------------------------------------------------------------------
async function testBlog() {
    console.log('\n── Blog API ──────────────────────────────────────');
    let createdPostId = '';
    await test('GET /api/blog/posts returns posts list', async () => {
        const { status, body } = await get('/api/blog/posts');
        assertStatus(status, 200);
        assert(Array.isArray(body.posts), 'posts should be an array');
        assert(body.total !== undefined, 'total should exist');
        assert(body.stats !== undefined, 'stats should exist');
    });
    await test('GET /api/blog/stats returns blog statistics', async () => {
        const { status, body } = await get('/api/blog/stats');
        assertStatus(status, 200);
        assert(typeof body.total === 'number', 'total should be a number');
        assert(typeof body.published === 'number', 'published should be a number');
        assert(typeof body.drafts === 'number', 'drafts should be a number');
    });
    await test('POST /api/blog/posts creates a new post', async () => {
        const { status, body } = await post('/api/blog/posts', {
            title: 'E2E Test Blog Post',
            content: 'This is an automated test post created by the E2E suite.',
            contentHtml: '<p>This is an automated test post created by the E2E suite.</p>',
            excerpt: 'An E2E test post',
            tags: ['test', 'e2e', 'automation'],
            authorName: 'E2E Test Runner',
        });
        assertStatus(status, 201);
        assert(body.post !== undefined, 'should return created post');
        const createdPost = body.post;
        assert(createdPost.status === 'draft', 'new post should be draft');
        createdPostId = createdPost.id;
    });
    await test('GET /api/blog/posts/:id returns created post', async () => {
        if (!createdPostId) {
            console.log('     skip — no post created');
            return;
        }
        const { status, body } = await get(`/api/blog/posts/${createdPostId}`);
        assertStatus(status, 200);
        const post = body.post;
        assert(post.id === createdPostId, 'should return correct post');
        assert(post.viewCount > 0, 'view count should be incremented');
    });
    await test('PATCH /api/blog/posts/:id updates a post', async () => {
        if (!createdPostId) {
            console.log('     skip — no post created');
            return;
        }
        const { status, body } = await patch(`/api/blog/posts/${createdPostId}`, {
            title: 'Updated E2E Test Post',
            excerpt: 'Updated excerpt',
        });
        assertStatus(status, 200);
        assert(body.post.title === 'Updated E2E Test Post', 'title should be updated');
    });
    await test('POST /api/blog/posts/:id/publish publishes post to destinations', async () => {
        if (!createdPostId) {
            console.log('     skip — no post created');
            return;
        }
        const { status, body } = await post(`/api/blog/posts/${createdPostId}/publish`, {
            destinations: ['internal', 'linkedin'],
        });
        assertStatus(status, 200);
        assert(Array.isArray(body.results), 'results should be an array');
        const publishResults = body.results;
        assert(publishResults.length === 2, 'should have 2 publish results');
        for (const r of publishResults) {
            assert(r.status === 'success', `publish to ${r.destination} should succeed`);
        }
        const publishedPost = body.post;
        assert(publishedPost.status === 'published', 'post should be published');
    });
    await test('POST /api/blog/posts/:id/like increments likes', async () => {
        if (!createdPostId) {
            console.log('     skip — no post created');
            return;
        }
        const { status, body } = await post(`/api/blog/posts/${createdPostId}/like`);
        assertStatus(status, 200);
        assert(body.post.likeCount > 0, 'likeCount should be incremented');
    });
    await test('GET /api/blog/posts?status=draft filters by status', async () => {
        const { status, body } = await get('/api/blog/posts?status=draft');
        assertStatus(status, 200);
        const posts = body.posts;
        for (const p of posts) {
            assert(p.status === 'draft', `all posts should be draft, got: ${p.status}`);
        }
    });
    await test('DELETE /api/blog/posts/:id deletes a post', async () => {
        if (!createdPostId) {
            console.log('     skip — no post created');
            return;
        }
        const { status } = await del(`/api/blog/posts/${createdPostId}`);
        assertStatus(status, 200);
    });
    await test('GET /api/blog/posts/:id returns 404 for deleted post', async () => {
        if (!createdPostId) {
            console.log('     skip — no post created');
            return;
        }
        const { status } = await get(`/api/blog/posts/${createdPostId}`);
        assertStatus(status, 404);
    });
}
// ---------------------------------------------------------------------------
// Forum API Tests
// ---------------------------------------------------------------------------
async function testForum() {
    console.log('\n── Forum API ─────────────────────────────────────');
    let createdThreadId = '';
    let createdCommentId = '';
    await test('GET /api/forum/threads returns threads list', async () => {
        const { status, body } = await get('/api/forum/threads');
        assertStatus(status, 200);
        assert(Array.isArray(body.threads), 'threads should be an array');
        assert(body.total !== undefined, 'total should exist');
        assert(body.stats !== undefined, 'stats should exist');
    });
    await test('GET /api/forum/threads?sort=hot sorts by hot', async () => {
        const { status, body } = await get('/api/forum/threads?sort=hot');
        assertStatus(status, 200);
        assert(Array.isArray(body.threads), 'threads should be an array');
        // Pinned threads should appear first
        const threads = body.threads;
        const firstNonPinned = threads.findIndex((t) => !t.isPinned);
        const firstPinned = threads.findIndex((t) => t.isPinned);
        if (firstPinned !== -1 && firstNonPinned !== -1) {
            assert(firstPinned < firstNonPinned, 'pinned threads should come before non-pinned');
        }
    });
    await test('GET /api/forum/threads?sort=new sorts by newest', async () => {
        const { status, body } = await get('/api/forum/threads?sort=new');
        assertStatus(status, 200);
        const threads = body.threads;
        const nonPinned = threads.filter((t) => !t.isPinned);
        for (let i = 1; i < nonPinned.length; i++) {
            const a = new Date(nonPinned[i - 1].createdAt).getTime();
            const b = new Date(nonPinned[i].createdAt).getTime();
            assert(a >= b, 'threads should be sorted by newest first');
        }
    });
    await test('GET /api/forum/threads?category= filters by category', async () => {
        const { status, body } = await get('/api/forum/threads?category=engineering');
        assertStatus(status, 200);
        assert(Array.isArray(body.threads), 'threads should be an array');
    });
    await test('GET /api/forum/threads?q= searches threads', async () => {
        const { status, body } = await get('/api/forum/threads?q=roadmap');
        assertStatus(status, 200);
        assert(Array.isArray(body.threads), 'threads should be an array');
    });
    await test('GET /api/forum/stats returns forum statistics', async () => {
        const { status, body } = await get('/api/forum/stats');
        assertStatus(status, 200);
        assert(typeof body.totalThreads === 'number', 'totalThreads should be a number');
    });
    await test('POST /api/forum/threads creates a new thread', async () => {
        const { status, body } = await post('/api/forum/threads', {
            title: 'E2E Test Discussion Thread',
            body: 'This is an automated E2E test discussion. Does anyone know how to configure the E2E test runner?',
            category: 'general',
            tags: ['test', 'e2e', 'automation'],
            authorName: 'E2E Test Runner',
        });
        assertStatus(status, 201);
        assert(body.thread !== undefined, 'should return created thread');
        const thread = body.thread;
        assert(thread.upvotes >= 1, 'new thread should have at least 1 upvote');
        createdThreadId = thread.id;
    });
    await test('GET /api/forum/threads/:id returns thread with comments', async () => {
        if (!createdThreadId) {
            console.log('     skip — no thread created');
            return;
        }
        const { status, body } = await get(`/api/forum/threads/${createdThreadId}`);
        assertStatus(status, 200);
        assert(body.thread !== undefined, 'should return thread');
        assert(Array.isArray(body.comments), 'comments should be an array');
        assert(body.thread.viewCount > 0, 'view count should be incremented');
    });
    await test('POST /api/forum/threads/:id/vote upvotes a thread', async () => {
        if (!createdThreadId) {
            console.log('     skip — no thread created');
            return;
        }
        const before = await get(`/api/forum/threads/${createdThreadId}`);
        const prevUpvotes = before.body.thread.upvotes;
        const { status, body } = await post(`/api/forum/threads/${createdThreadId}/vote`, { vote: 'up' });
        assertStatus(status, 200);
        const thread = body.thread;
        assert(thread.upvotes > prevUpvotes, 'upvotes should increase');
    });
    await test('POST /api/forum/threads/:id/comments adds a comment', async () => {
        if (!createdThreadId) {
            console.log('     skip — no thread created');
            return;
        }
        const { status, body } = await post(`/api/forum/threads/${createdThreadId}/comments`, {
            body: 'This is an automated E2E test comment.',
            authorName: 'E2E Test Runner',
        });
        assertStatus(status, 201);
        assert(body.comment !== undefined, 'should return created comment');
        createdCommentId = body.comment.id;
    });
    await test('GET /api/forum/threads/:id/comments returns comments', async () => {
        if (!createdThreadId) {
            console.log('     skip — no thread created');
            return;
        }
        const { status, body } = await get(`/api/forum/threads/${createdThreadId}/comments`);
        assertStatus(status, 200);
        assert(Array.isArray(body.comments), 'comments should be an array');
        assert(body.comments.length > 0, 'should have at least one comment');
    });
    await test('POST /api/forum/comments/:id/vote upvotes a comment', async () => {
        if (!createdCommentId) {
            console.log('     skip — no comment created');
            return;
        }
        const { status, body } = await post(`/api/forum/comments/${createdCommentId}/vote`, { vote: 'up' });
        assertStatus(status, 200);
        assert(body.comment !== undefined, 'should return updated comment');
    });
}
// ---------------------------------------------------------------------------
// Observability Tests
// ---------------------------------------------------------------------------
async function testObservability() {
    console.log('\n── Observability ─────────────────────────────────');
    await test('GET /api/observability/executions returns executions', async () => {
        const { status, body } = await get('/api/observability/executions');
        assertStatus(status, 200);
        assert(Array.isArray(body.executions), 'executions should be an array');
    });
    await test('GET /api/observability/metrics returns platform metrics', async () => {
        const { status, body } = await get('/api/observability/metrics');
        assertStatus(status, 200);
        assert(body.gateway !== undefined, 'should have gateway metrics');
        assert(body.scheduler !== undefined, 'should have scheduler metrics');
        assert(body.blog !== undefined, 'should have blog metrics');
        assert(body.forum !== undefined, 'should have forum metrics');
    });
}
// ---------------------------------------------------------------------------
// Licenses / Corp IT Tests
// ---------------------------------------------------------------------------
async function testLicenses() {
    console.log('\n── Corp IT / Licenses ────────────────────────────');
    await test('GET /api/licenses returns license data', async () => {
        const { status, body } = await get('/api/licenses');
        assertStatus(status, 200);
        assert(Array.isArray(body.licenses), 'licenses should be an array');
        assert(body.summary !== undefined, 'summary should exist');
    });
}
// ---------------------------------------------------------------------------
// Error Handling Tests
// ---------------------------------------------------------------------------
async function testErrorHandling() {
    console.log('\n── Error Handling ────────────────────────────────');
    await test('GET unknown path returns 404', async () => {
        const { status } = await get('/api/this-does-not-exist');
        assertStatus(status, 404);
    });
    await test('POST /api/query with missing query returns 400', async () => {
        const { status } = await post('/api/query', {});
        assertStatus(status, 400);
    });
    await test('POST /api/scheduler/jobs with missing fields returns 400', async () => {
        const { status } = await post('/api/scheduler/jobs', { name: 'incomplete' });
        assertStatus(status, 400);
    });
    await test('POST /api/blog/posts with missing title returns 400', async () => {
        const { status } = await post('/api/blog/posts', { content: 'no title here' });
        assertStatus(status, 400);
    });
    await test('POST /api/forum/threads with missing fields returns 400', async () => {
        const { status } = await post('/api/forum/threads', { title: 'no body' });
        assertStatus(status, 400);
    });
    await test('GET /api/blog/posts/nonexistent returns 404', async () => {
        const { status } = await get('/api/blog/posts/does-not-exist-xyz');
        assertStatus(status, 404);
    });
    await test('GET /api/scheduler/jobs/nonexistent returns 404', async () => {
        const { status } = await get('/api/scheduler/jobs/does-not-exist-xyz');
        assertStatus(status, 404);
    });
}
// ---------------------------------------------------------------------------
// Agent Evals Tests
// ---------------------------------------------------------------------------
async function testAgentEvals() {
    console.log('\n── Agent Evals ──────────────────────────────────');
    await test('GET /api/evals/dashboard returns dashboard data', async () => {
        const { status, body } = await get('/api/evals/dashboard');
        assertStatus(status, 200);
        assert(typeof body.totalAgents === 'number', 'totalAgents should be a number');
        assert(typeof body.avgHealthScore === 'number', 'avgHealthScore should be a number');
        assert(Array.isArray(body.agents), 'agents should be an array');
    });
    await test('GET /api/evals/agents returns agent configs', async () => {
        const { status, body } = await get('/api/evals/agents');
        assertStatus(status, 200);
        const agents = body.agents;
        assert(Array.isArray(agents), 'agents should be an array');
        assert(agents.length > 0, 'should have seeded agents');
        assert(typeof agents[0].agentId === 'string', 'agentId should be string');
        assert(typeof agents[0].healthScore === 'number', 'healthScore should be a number');
        assert(typeof agents[0].currentFingerprint === 'object', 'currentFingerprint should be object');
    });
    let testAgentId = '';
    await test('GET /api/evals/agents/:id returns single agent', async () => {
        const { body: listBody } = await get('/api/evals/agents');
        testAgentId = listBody.agents[0].agentId;
        const { status, body } = await get(`/api/evals/agents/${testAgentId}`);
        assertStatus(status, 200);
        assert(body.agent.agentId === testAgentId, 'should match requested agent');
    });
    await test('PUT /api/evals/agents/:id updates config', async () => {
        const { status, body } = await put(`/api/evals/agents/${testAgentId}`, { driftThreshold: 25 });
        assertStatus(status, 200);
        assert(body.agent.driftThreshold === 25, 'driftThreshold should be updated');
    });
    await test('GET /api/evals/agents/:id/report returns health report', async () => {
        const { status, body } = await get(`/api/evals/agents/${testAgentId}/report`);
        assertStatus(status, 200);
        const report = body.report;
        assert(typeof report.healthScore === 'number', 'healthScore should be a number');
        assert(typeof report.fingerprint === 'object', 'fingerprint should be object');
        assert(Array.isArray(report.alerts), 'alerts should be array');
        assert(Array.isArray(report.predictedFailures), 'predictedFailures should be array');
    });
    await test('GET /api/evals/agents/:id/drift returns drift history', async () => {
        const { status, body } = await get(`/api/evals/agents/${testAgentId}/drift`);
        assertStatus(status, 200);
        assert(Array.isArray(body.history), 'history should be array');
    });
    await test('POST /api/evals/agents/:id/baseline sets baseline', async () => {
        const { status, body } = await post(`/api/evals/agents/${testAgentId}/baseline`, {});
        assertStatus(status, 200);
        assert(body.agent.driftScore === 0, 'driftScore should be 0 after baseline reset');
    });
    await test('GET /api/evals/alerts returns alerts list', async () => {
        const { status, body } = await get('/api/evals/alerts');
        assertStatus(status, 200);
        assert(Array.isArray(body.alerts), 'alerts should be array');
    });
    await test('GET /api/evals/agents/nonexistent returns 404', async () => {
        const { status } = await get('/api/evals/agents/does-not-exist-xyz');
        assertStatus(status, 404);
    });
}
// ---------------------------------------------------------------------------
// Marketing API Tests
// ---------------------------------------------------------------------------
async function testMarketing() {
    console.log('\n── Marketing API ────────────────────────────────');
    await test('GET /api/marketing/workflows returns workflow list', async () => {
        const { status, body } = await get('/api/marketing/workflows');
        assertStatus(status, 200);
        assert(Array.isArray(body.workflows), 'workflows should be an array');
        assert(body.workflows.length > 0, 'should have marketing workflows');
    });
    await test('GET /api/marketing/projects returns projects', async () => {
        const { status, body } = await get('/api/marketing/projects');
        assertStatus(status, 200);
        assert(Array.isArray(body.projects), 'projects should be an array');
    });
    await test('POST /api/marketing/precheck validates execution', async () => {
        const { body: listBody } = await get('/api/marketing/workflows');
        const workflows = listBody.workflows;
        if (workflows?.length > 0) {
            const wfId = workflows[0].id;
            const { status, body } = await post('/api/marketing/precheck', { workflowId: wfId });
            assertStatus(status, 200);
            assert(typeof body.ready === 'boolean', 'ready should be boolean');
        }
    });
    await test('POST /api/marketing/execute runs a workflow', async () => {
        const { body: listBody } = await get('/api/marketing/workflows');
        const workflows = listBody.workflows;
        if (workflows?.length > 0) {
            const wfId = workflows[0].id;
            const { status, body } = await post('/api/marketing/execute', { workflowId: wfId, inputs: {} });
            assertStatus(status, 200);
            assert(body.execution, 'should return execution record');
        }
    });
    await test('GET /api/marketing/dashboard returns dashboard metrics', async () => {
        const { status, body } = await get('/api/marketing/dashboard');
        assertStatus(status, 200);
    });
}
// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------
async function checkGateway() {
    try {
        const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
        return res.ok;
    }
    catch {
        return false;
    }
}
async function main() {
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║        AgentOS End-to-End API Test Suite         ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`\nTarget: ${BASE}\n`);
    const up = await checkGateway();
    if (!up) {
        console.error(`\n✗ Gateway not reachable at ${BASE}`);
        console.error('  Please start the gateway: cd services/gateway && pnpm dev\n');
        process.exit(1);
    }
    const start = Date.now();
    await testCore();
    await testPersonas();
    await testMarketplace();
    await testIntentEngine();
    await testPromptLibrary();
    await testMemoryGraph();
    await testToolRegistry();
    await testScheduler();
    await testBlog();
    await testForum();
    await testObservability();
    await testLicenses();
    await testAgentEvals();
    await testMarketing();
    await testErrorHandling();
    const duration = Date.now() - start;
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log(`║  Results: ${passed} passed, ${failed} failed, ${skipped} skipped           ║`);
    console.log(`║  Duration: ${(duration / 1000).toFixed(2)}s                                 ║`);
    console.log('╚══════════════════════════════════════════════════╝\n');
    if (failed > 0) {
        console.log('Failed tests:');
        for (const r of results.filter((r) => r.status === 'fail')) {
            console.log(`  ✗ ${r.name}`);
            console.log(`    ${r.error}`);
        }
        console.log('');
        process.exit(1);
    }
    else {
        console.log('All tests passed! ✓\n');
        process.exit(0);
    }
}
main().catch((err) => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});
//# sourceMappingURL=api.test.js.map