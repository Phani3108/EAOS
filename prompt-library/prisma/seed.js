"use strict";
/**
 * AgentOS Prompt Library — Database Seed
 *
 * Seeds the database with platform and community prompts.
 * Run with: npx tsx prisma/seed-agentos.ts
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
// Functional unit categories
const platformCategories = [
    // Technology & Engineering
    { name: "Engineering", slug: "engineering", icon: "⚙️", order: 1 },
    { name: "Quality Assurance", slug: "quality-assurance", icon: "✅", order: 2 },
    { name: "SRE & DevOps", slug: "sre-devops", icon: "🔧", order: 3 },
    // Product & User Experience
    { name: "Product & Solution", slug: "product-solution", icon: "🎯", order: 4 },
    { name: "Solution Architecture", slug: "solution-architecture", icon: "🧩", order: 5 },
    { name: "UX & Design", slug: "ux-design", icon: "🎨", order: 6 },
    { name: "Program & Release", slug: "program-release", icon: "🚀", order: 7 },
    { name: "Documentation", slug: "documentation", icon: "📝", order: 8 },
    // Operations
    { name: "Operations", slug: "operations", icon: "🏦", order: 9 },
    { name: "Customer Support", slug: "customer-support", icon: "🤝", order: 10 },
    { name: "Monitoring & Observability", slug: "monitoring-observability", icon: "📡", order: 11 },
    { name: "Talent & HR", slug: "talent-hr", icon: "👥", order: 12 },
    // Data & Intelligence
    { name: "Business Intelligence", slug: "business-intelligence", icon: "📊", order: 13 },
    { name: "Data Science", slug: "data-science", icon: "🔬", order: 14 },
    // Strategy & Agents
    { name: "Leadership & Strategy", slug: "leadership-strategy", icon: "💼", order: 15 },
    { name: "Security & Compliance", slug: "security-compliance", icon: "🛡️", order: 16 },
    { name: "Agent Design", slug: "agent-design", icon: "🤖", order: 17 },
];
// SDLC phase-based and topic tags
const platformTags = [
    { name: "Requirements", slug: "requirements", color: "#6366f1" },
    { name: "Design", slug: "design", color: "#8b5cf6" },
    { name: "Development", slug: "development", color: "#3b82f6" },
    { name: "Code Review", slug: "code-review", color: "#0ea5e9" },
    { name: "Testing", slug: "testing", color: "#14b8a6" },
    { name: "CI/CD", slug: "cicd", color: "#22c55e" },
    { name: "Deployment", slug: "deployment", color: "#eab308" },
    { name: "Monitoring", slug: "monitoring", color: "#f97316" },
    { name: "Incident Response", slug: "incident-response", color: "#ef4444" },
    { name: "Documentation", slug: "documentation", color: "#a855f7" },
];
// Platform prompts
const platformPrompts = [
    {
        title: "Conventional Commit Message Generator",
        slug: "conventional-commit-message-generator",
        description: "Generate commit messages following conventional commit convention with ticket prefix",
        content: `Generate a conventional commit message for the following code changes.

**Format:**
\`\`\`
[TICKET-ID] <type>(<scope>): <subject>

<body>

<footer>
\`\`\`

**Rules:**
- **Ticket ID:** Always prefix with the ticket ID in square brackets (e.g., \`[PROJ-46329]\`)
- **Type:** One of: \`feat\`, \`fix\`, \`docs\`, \`style\`, \`refactor\`, \`perf\`, \`test\`, \`chore\`, \`ci\`, \`build\`
- **Scope:** Optional, indicates the functional component or area affected (e.g., \`auth\`, \`api\`, \`db\`)
- **Subject:** Imperative mood, lowercase, no period at end, max 50 characters
- **Body:** Optional, explain WHY not HOW, wrap at 80 characters, max 13 lines
- **Footer:** Optional, reference related issues or breaking changes

**Type Definitions:**
- \`feat\`: A new feature
- \`fix\`: A bug fix
- \`docs\`: Documentation only changes
- \`style\`: Changes that don't affect code meaning (formatting, whitespace)
- \`refactor\`: Code change that neither fixes a bug nor adds a feature
- \`perf\`: Performance improvements
- \`test\`: Adding or updating tests
- \`chore\`: Maintenance tasks, dependency updates, tooling changes
- \`ci\`: CI/CD configuration changes
- \`build\`: Changes to build system or external dependencies

**Examples:**
\`\`\`
[PROJ-46329] feat(auth): add GitHub SSO integration

Enable GitHub OAuth for single sign-on, replacing the legacy
LDAP-based authentication. Simplifies onboarding for developers
who already have GitHub organization access.

Closes: PROJ-46330
\`\`\`

\`\`\`
[PROJ-46329] fix(api): resolve null pointer on empty request body
\`\`\`

\`\`\`
[PROJ-46329] refactor(utils): simplify date formatting logic
\`\`\`

**Instructions:**
1. Analyze the diff or description of changes provided
2. Determine the most appropriate commit type
3. Identify the scope from the affected component
4. Write a concise subject in imperative mood
5. Add a body ONLY if the "why" isn't obvious from the subject
6. Include footer references if applicable

Provide the commit message ready to use.`,
        type: client_1.PromptType.TEXT,
        category: "engineering",
        tags: ["development", "code-review"],
        isFeatured: true,
        isPrivate: false,
    },
    {
        title: "Architectural Decision Record (ADR) Generator",
        slug: "architectural-decision-record-generator",
        description: "Generate a structured ADR with context, options, trade-offs, and decision rationale",
        content: `Generate an Architectural Decision Record (ADR).

**Context to provide:**
[Describe the architectural challenge, business driver, or design problem you are solving]

---

# [Title: Descriptive Name of the Decision]

- **Date**: YYYY-MM-DD
- **Status**: Draft / Decided / Superseded by ADR-XXX
- **Owner**: [Team or Individual]
- **Consulted Stakeholders**: [List with @mentions]

## Context

- **Background**: What led to this decision?
- **Problem**: What architectural or business challenge are we solving?
- **Drivers**: What constraints, goals, or requirements shape the decision?

## Evaluation Criteria

List what matters for this decision:
- Scalability
- Security
- Developer experience
- Reusability
- Auditability
- Cost

## Options Considered

| Option | Description | Pros | Cons | Score (0–5) |
|--------|-------------|------|------|-------------|
| A | [Option A] | + [Pro] | – [Con] | ? |
| B | [Option B] | + [Pro] | – [Con] | ? |
| C | [Option C] | + [Pro] | – [Con] | ? |

## Decision

- What was chosen and why?
- Justify based on evaluation criteria and trade-offs.

## Consequences

- **Benefits**: What improves?
- **Costs**: What gets harder, riskier, or slower?
- **Mitigations** (if applicable): How are risks addressed?

## Consultation

- Who contributed to or reviewed this ADR?
- Were any key stakeholders consulted? Document dissent or notable discussion.

## Links and References

- Related ADRs: ADR-XXX
- Design docs / RFCs / Slack threads / JIRA tickets

## Notes

- Optional future revisit trigger (e.g., "Revisit if XYZ changes")

---

**ADR Lifecycle Statuses:**
- \`Draft\` — Under active discussion and review
- \`Decided\` — Finalized and adopted
- \`Superseded\` — Replaced by a newer ADR
- \`Rejected\` — Deliberately not chosen
- \`Deprecated\` — No longer applicable but not replaced

**ADR Best Practices:**
- Keep ADRs concise but comprehensive — focus on trade-offs and rationale
- Store in version control under \`docs/adr/\`
- Use incrementing IDs: \`ADR1-<short-title>\`, \`ADR2-<short-title>\`
- Never edit finalized ADRs — supersede them with a new one
- Write for the future reader who lacks current context
- Link to architecture characteristics (e.g., \`AC01: Scalability\`, \`AC05: Security\`)`,
        type: client_1.PromptType.TEXT,
        category: "solution-architecture",
        tags: ["design", "documentation", "requirements"],
        isFeatured: true,
        isPrivate: false,
    },
    {
        title: "Comprehensive Unit Test Generator",
        slug: "unit-test-generator",
        description: "Generate production-quality unit tests — F.I.R.S.T principles, AAA pattern, and meaningful coverage",
        content: `Generate unit tests for the following code.

**Code to test:**
\`\`\`
[Paste your class, method, or function here]
\`\`\`

**Context (optional):**
- Language / Framework: [e.g., Java + JUnit 5 + Mockito, TypeScript + Jest, Python + pytest]
- Type: [Greenfield / Brownfield / Legacy]
- Focus areas: [e.g., edge cases, error handling, boundary conditions]

---

## What to generate

Produce unit tests that:

### 1. Follow the AAA Pattern (Arrange → Act → Assert)
- **Arrange**: Set up the system under test (SUT) and its dependencies
- **Act**: Invoke the single behavior being tested (one-liner preferred)
- **Assert**: Verify the expected outcome with clear, descriptive assertions

### 2. Apply F.I.R.S.T Principles
- **Fast**: Tests run in milliseconds with no I/O or network calls
- **Independent**: No shared mutable state between tests; runnable in any order
- **Repeatable**: Deterministic — mock time, randomness, and external services
- **Self-Validating**: Pass/fail without manual inspection; clear failure messages
- **Targeted**: Cover critical paths, boundary conditions, and business logic

### 3. Cover the right scenarios
For each method under test, generate cases for:

**Structured Basis (code paths):**
- Happy path (nominal flow)
- Each distinct branch / conditional

**Boundary Analysis:**
- Just below, at, and just above each boundary value

**Bad Data:**
- Null / empty / uninitialized inputs
- Invalid types or formats
- Values exceeding expected limits

**Good Data:**
- Minimum valid input
- Maximum valid input
- Typical / representative values

### 4. Name tests descriptively
Use camelCase. Name should describe the scenario, not the method:
- ❌ \`isDeliveryValidInvalidDateReturnsFalse()\`
- ✅ \`deliveryWithPastDateIsInvalid()\`

Format: \`<subject>_<scenario>_<expectedOutcome>\` or plain behavior description.

### 5. Isolate the SUT properly
- Mock all external collaborators (databases, HTTP clients, services) using the appropriate framework (Mockito, Jest \`jest.fn()\`, unittest.mock, etc.)
- Do NOT connect to real databases, external APIs, or filesystems
- Prefer mocking interfaces over concrete classes
- Keep test-specific code out of production code

### 6. Focus on high-value code
Prioritize testing:
1. **Domain models and algorithms** — complex business logic with few collaborators
2. **Boundary and error-handling paths** — where bugs hide
3. **Critical paths** — code that cannot afford to break

Skip or minimize tests for:
- Trivial getters/setters and POJOs (unless behavior exists)
- Framework boilerplate

---

## Code smell checks

Flag these in the generated tests or suggest refactoring if observed:
- Logic in tests (if/else, loops) → simplify or parameterize
- Setup larger than the act → extract to factory or \`@BeforeEach\`
- More than one \`act\` per test → split into separate tests
- Mocking concrete classes → suggest interface extraction

---

## Output format

For each test class:
1. Import block
2. Class declaration with \`@ExtendWith\` / \`describe\` block
3. Setup (\`@BeforeEach\` / \`beforeEach\`) if shared
4. Grouped test methods with descriptive names
5. Inline comments only where the intent isn't obvious

Generate complete, compilable test code — not pseudocode.`,
        type: client_1.PromptType.TEXT,
        category: "quality-assurance",
        tags: ["testing", "development", "code-review"],
        isFeatured: true,
        isPrivate: false,
    },
    {
        title: "Structured Release Notes Generator",
        slug: "release-notes-generator",
        description: "Generate structured release notes covering features, bug fixes, dependencies, deployment instructions, and rollback plan",
        content: `Generate release notes for a service release.

**Inputs to provide:**
- **Service / Cluster name and version**: e.g., Athena v2.5.61
- **SPOC**: Name and email of the release owner
- **Changes**: List of JIRA tickets with type (feature / bug / improvement / sunset / deprecated)
- **Module dependency changes**: Previous → current versions
- **Deployment steps**: DDL/DML PRs, config changes, cache keys, Heracles routes
- **Minimum supported version** for upgrade path

---

## [Service Name] Release Notes [vX.Y.Z]

## Overview
[Concise summary of the release — what changed, why it matters, and the key highlights. 3–5 sentences maximum.]

## SPOCs of the release
- [Full Name] [email]

---

## Detailed Changes

### New Features
- **[Feature Title]** - [Ticket link](https://your-tracker.example.com/browse/TICKET-ID)
    - What this feature does and its purpose.
    - How users/operators can access or configure it.
    - Any relevant documentation links.

*(Repeat for each new feature)*

### Bug Fixes
- **[Bug Title]** - [Ticket link](https://your-tracker.example.com/browse/TICKET-ID)
    - Brief description of the bug, its impact, and how it was fixed.

*(Repeat for each fix)*

### Improvements and Enhancements
- **[Improvement Title]** - [Ticket link](https://your-tracker.example.com/browse/TICKET-ID)
    - What was improved and the observable benefit (performance, reliability, DX, etc.).

*(Repeat for each improvement)*

### Sunset Features
- **[Feature/API name]:** Brief description of what was removed and migration path. [Migration guide](#)

### Deprecated Features
- **[Feature/API name]:** Brief description of the deprecation. [Migration guide](#)
    - Sunset timeline: [e.g., End of Q2 2026]

### Module Dependencies
| Module name | Previous version | Current version |
|-------------|-----------------|-----------------|
| [Module 1]  | [vX.Y.Z]        | [vA.B.C]        |
| [Module 2]  | [vX.Y.Z]        | [vA.B.C]        |

### External Dependencies
- **[Dependency name]:** Description of the dependency change or requirement.
- NA *(if none)*

---

## Suggested Upgrade Path
- Supported version: [Minimum cluster spec version that supports this upgrade]

---

## Deployment Instructions

### Pre-Deployment Steps
1. **DDL changes**
    - [Link to DDL PR or migration script]
2. **DML changes**
    - [Link to DML PR] *(or NA)*
3. **Cache invalidation**
    - Invalidate cache key \`[key]\` from all \`[service]\` pods
4. **Heracles Routes in CDD**
    - [Describe route additions/removals with sample PR link]
5. **Config map updates**
   | Service     | Config key  | Value   |
   |-------------|-------------|---------|
   | [SERVICE_1] | [KEY_1]     | [VAL_1] |
   | [SERVICE_1] | [KEY_2]     | [VAL_2] |
6. **Other prerequisite steps**
    - [e.g., Verify module X vA.B.C is deployed first]

### Post-Deployment Checks
1. **Cache invalidation** *(if applicable)*
    - Invalidate cache key \`[key]\` from \`[service]\` pods
2. **Verification steps**
    - [Link to deployment verification runbook or checklist]
    - Monitor [relevant dashboard or CSN link]

---

## Rollback Plan
1. [Any manual rollback steps beyond weave rollback, e.g., DDL reversals]
2. Validate rollback by [specific checks — dashboards, service health, error rates]

---

**Release Notes Best Practices:**
- Be specific — link every change to a ticket
- Deployment steps must be ordered and actionable; a new engineer should be able to follow them
- Always specify the minimum supported upgrade version
- Flag breaking changes (sunset/deprecated) prominently with migration guides and timelines
- Post-deployment checks must include observable signals (dashboards, CSN links, error rates)
- Rollback plan must be unambiguous — include validation criteria, not just "rollback and check"`,
        type: client_1.PromptType.TEXT,
        category: "program-release",
        tags: ["deployment", "documentation", "cicd"],
        isFeatured: true,
        isPrivate: false,
    },
];
async function main() {
    console.log("🌱 Seeding AgentOS Prompt Library database...\n");
    // Create admin user
    const password = await bcryptjs_1.default.hash("AgentOSAdmin2026!", 12);
    const admin = await prisma.user.upsert({
        where: { email: "admin@agentos.dev" },
        update: {},
        create: {
            email: "admin@agentos.dev",
            username: "prompt-librarian",
            name: "AgentOS Prompt Librarian",
            password: password,
            role: "ADMIN",
            locale: "en",
        },
    });
    console.log("✅ Created admin user: admin@agentos.dev\n");
    // Clean stale categories (remove any not in our defined list)
    const validCategorySlugs = platformCategories.map(c => c.slug);
    await prisma.category.deleteMany({
        where: { slug: { notIn: validCategorySlugs } },
    });
    console.log(`🧹 Cleaned stale categories\n`);
    // Create categories
    console.log(`📁 Creating ${platformCategories.length} categories...`);
    const categoryMap = new Map();
    for (const cat of platformCategories) {
        const category = await prisma.category.upsert({
            where: { slug: cat.slug },
            update: { name: cat.name, icon: cat.icon, order: cat.order },
            create: cat,
        });
        categoryMap.set(cat.slug, category.id);
    }
    console.log(`✅ Created ${platformCategories.length} categories\n`);
    // Clean stale tags (remove any not in our defined list)
    const validTagSlugs = platformTags.map(t => t.slug);
    await prisma.promptTag.deleteMany({
        where: { tag: { slug: { notIn: validTagSlugs } } },
    });
    await prisma.tag.deleteMany({
        where: { slug: { notIn: validTagSlugs } },
    });
    console.log(`🧹 Cleaned stale tags\n`);
    // Create tags
    console.log(`🏷️  Creating ${platformTags.length} tags...`);
    const tagMap = new Map();
    for (const tag of platformTags) {
        const createdTag = await prisma.tag.upsert({
            where: { slug: tag.slug },
            update: { name: tag.name, color: tag.color },
            create: tag,
        });
        tagMap.set(tag.slug, createdTag.id);
    }
    console.log(`✅ Created ${platformTags.length} tags\n`);
    // Create prompts
    console.log(`💡 Creating ${platformPrompts.length} platform prompts...`);
    let created = 0;
    for (const promptData of platformPrompts) {
        const { tags, category, ...promptFields } = promptData;
        // Check if prompt already exists
        const existing = await prisma.prompt.findFirst({
            where: { slug: promptData.slug },
        });
        const prompt = existing
            ? await prisma.prompt.update({
                where: { id: existing.id },
                data: {
                    ...promptFields,
                    categoryId: categoryMap.get(category) || null,
                },
            })
            : await prisma.prompt.create({
                data: {
                    ...promptFields,
                    authorId: admin.id,
                    categoryId: categoryMap.get(category) || null,
                },
            });
        // Connect tags
        if (tags.length > 0) {
            const tagIds = tags.map(tagSlug => tagMap.get(tagSlug)).filter(Boolean);
            // Create PromptTag records
            for (const tagId of tagIds) {
                await prisma.promptTag.upsert({
                    where: {
                        promptId_tagId: {
                            promptId: prompt.id,
                            tagId: tagId,
                        },
                    },
                    update: {},
                    create: {
                        promptId: prompt.id,
                        tagId: tagId,
                    },
                });
            }
        }
        created++;
        console.log(`   ✓ ${promptData.title}`);
    }
    console.log(`\n✅ Created ${created} prompts\n`);
    console.log("╔═══════════════════════════════════════════════════════════╗");
    console.log("║                                                           ║");
    console.log("║   🎉 AgentOS Prompt Library seeded successfully!         ║");
    console.log("║                                                           ║");
    console.log("╚═══════════════════════════════════════════════════════════╝");
    console.log("\nLogin credentials:");
    console.log("  Email:    admin@agentos.dev");
    console.log("\nDatabase contents:");
    console.log(`  Categories: ${platformCategories.length}`);
    console.log(`  Tags:       ${platformTags.length}`);
    console.log(`  Prompts:    ${created}`);
    console.log("");
}
main()
    .catch((e) => {
    console.error("❌ Error seeding database:", e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map