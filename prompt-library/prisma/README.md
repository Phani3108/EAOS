# Database Seeding for Local Test

This directory contains seed scripts for populating the AgentOS Prompt Library database.

## Seed Scripts

### `seed.ts` (Recommended for AgentOS) ✅

Custom seed file with **organization-specific prompts** for engineering teams.

**Contents:**

- 8 Categories: Code Review, Architecture, Testing, Documentation, DevOps, Security, Performance, Data Engineering
- 10 Tags: Java, Python, Kubernetes, Spring Boot, Microservices, CI/CD, Terraform, PostgreSQL, Kafka, REST API
- 8 organization-specific prompts tailored for engineering workflows
- Admin user: `admin@agentos.dev` / ``

**Run:**

```bash
# Via Make (recommended)
make compose-seed

# Or manually
docker exec agentos-prompt-library npx tsx prisma/seed.ts
```

### `seed.ts` (Upstream Public Data)

Original seed from prompts.chat - downloads **~200+ public prompts** from <https://prompts.chat/prompts.json>

**Not recommended for production** - use for development/testing only.

**Run:**

```bash
docker exec agentos-prompt-library npx prisma db seed
```

## When to Seed

### Development/Testing ✅

Seed the database to get sample data for UI testing:

```bash
make compose-up
make compose-seed
```

### Production ❌

**Don't seed production databases** - let users create prompts organically through the UI.

## Seed Data Overview

### AgentOS-Specific Prompts

1. **Internal Code Review Checklist** (Featured)
   - Comprehensive code review following internal standards
   - Covers: functionality, quality, testing, security, performance, docs, DevOps

2. **Microservice Architecture Review** (Featured)
   - Review microservice designs against internal best practices
   - Service boundaries, communication, data, resilience, observability

3. **Terraform Infrastructure Review**
   - Review Terraform code for IaC best practices
   - Structure, state management, security, cost optimization

4. **Spring Boot API Development** (Featured)
   - Generate Spring Boot REST APIs following internal patterns
   - Complete with DTOs, service layer, tests, documentation

5. **PostgreSQL Query Optimization**
   - Analyze and optimize PostgreSQL queries
   - Execution plans, indexing strategies, query rewriting

6. **Kubernetes Deployment Manifest Review** (Featured)
   - Review K8s manifests for production readiness
   - Deployments, services, ingress, HPA, security contexts

7. **Security Vulnerability Assessment**
   - OWASP Top 10 security assessment
   - Authentication, data protection, input validation

8. **API Documentation Generator**
   - Generate comprehensive API documentation
   - OpenAPI/Swagger specs, examples, code samples

## Admin Access

After seeding:

- Email: `admin@agentos.dev`
- Password: ``
- Role: ADMIN

**⚠️ Change this password in production!**

## Resetting Database

To start fresh:

```bash
make compose-down
make compose-clean    # Removes volumes
make compose-up
make compose-seed     # Re-seed with prompts
```

## Customizing Seed Data

Edit `seed.ts` to add more organization-specific categories, tags, or prompts:

```typescript
const agentosPrompts = [
  {
    title: "Your Custom Prompt",
    slug: "your-custom-prompt",
    description: "Description here",
    content: "Prompt content...",
    type: PromptType.TEXT,
    category: "code-review",
    tags: ["java", "spring-boot"],
    isFeatured: false,
    isPrivate: false,
  },
  // ... more prompts
];
```

Then re-run:

```bash
make compose-seed
```
