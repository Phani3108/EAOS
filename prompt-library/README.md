# AgentOS Prompt Library

> An inner-source platform for curating, sharing, and managing prompts for AI-powered development tools — GitHub Copilot, Cursor, Claude, ChatGPT, Atlassian Rovo, and more.

## What is AgentOS Prompt Library?

AgentOS Prompt Library is a community-driven platform where engineers share prompt engineering best practices for various AI tools and copilots. It serves as a centralized portal for discovering, creating, and curating proven prompts that unlock the full potential of AI-powered development tools. Built on [prompts.chat](https://prompts.chat), extended with organization-specific functional practices, private prompt library, GitHub SSO, and Kubernetes-native deployment.

## Capabilities

- **Semantic Search** — AI-powered search to find the perfect prompt for your use case
- **Create & Share Prompts** — Submit and share prompts with structured formats (text, JSON, YAML) and media support
- **Version Control** — Track prompt evolution with built-in versioning and change request workflows
- **Personalized Feed** — Subscribe to categories and get a curated feed of prompts matching your interests
- **Voting & Leaderboard** — Community-driven quality through upvoting, flagging, and contributor rankings
- **Fork & Customize** — Duplicate any prompt into your own collection and adapt it to your workflow
- **Pin & Recommend** — Pin high-value prompts to the top and submit recommendations for new prompts
- **Private Prompts** — Keep experimental prompts private or share them across the organization
- **Categories & Tags** — Organize prompts by tool, use case, functional unit, or engineering domain

## Supported AI Tools

- **GitHub Copilot** — Code suggestions and chat prompts
- **Cursor** — AI-powered code editor prompts and rules
- **Claude** — Anthropic Claude for development and analysis
- **ChatGPT** — OpenAI GPT for general-purpose prompting
- **Atlassian Rovo** — Confluence and Jira AI assistant prompts
- **Microsoft Office Copilot** — Excel, Word, PowerPoint, Outlook, and Teams
- And more AI tools as they emerge

## Integration with AgentOS

The Prompt Library is natively integrated into the AgentOS platform:
- Accessible via the **Prompt Library** section in the sidebar
- Prompts feed into the **Skill Library** as reusable components
- **Tools Registry** shows all internal tools available to agents
- Community **Recommendations** system for crowdsourced prompt discovery

## Local Development

### Quick Start

```bash
# 1. Start infrastructure
make init

# 2. Set up environment
make setup

# 3. Deploy locally
make compose-install

# 4. Access at http://localhost:4445
```

**First run takes 2-3 minutes** as it builds from the upstream prompts.chat image.

### Common Commands

- `make help` — Show all available commands
- `make c` — Quick deploy with Docker Compose
- `make c-logs` — Stream application logs
- `make lint` — Validate configuration files
- `make test` — Run health checks

For complete developer workflows, troubleshooting, and Kubernetes deployment, see [DEVELOPING.md](DEVELOPING.md).

## Documentation

- **[DEVELOPING.md](DEVELOPING.md)** — Complete developer guide with all Make commands and workflows
- **[docs/self-hosting-approach.md](docs/plan/self-hosting-approach.md)** — Detailed explanation of how we self-host prompts.chat for K8s
- **[docs/environment-variables.md](docs/dev/environment-variables.md)** — Complete reference for build-time and runtime configuration
- **[docs/implementation-plan.md](docs/plan/implementation-plan.md)** — Original implementation plan and architecture decisions
