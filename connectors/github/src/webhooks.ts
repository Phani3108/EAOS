/**
 * EAOS GitHub Integration — PR reviews + incident webhooks
 *
 * Makes EAOS live inside the developer's natural workflow:
 *
 * 1. Auto-review new PRs for architecture, security, patterns
 * 2. Create incident analysis when alerts fire
 * 3. Respond to @eaos mentions in PR comments
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GitHubWebhookConfig {
    webhookSecret: string;
    githubToken: string;
    eaosGatewayUrl: string;
    autoReviewEnabled: boolean;
    reviewLabels: string[];     // only auto-review PRs with these labels
    ignoredPaths: string[];     // skip review for these file patterns
}

interface PullRequestEvent {
    action: 'opened' | 'synchronize' | 'reopened';
    number: number;
    pull_request: {
        html_url: string;
        title: string;
        body: string;
        user: { login: string };
        base: { ref: string; repo: { full_name: string } };
        head: { ref: string; sha: string };
        labels: Array<{ name: string }>;
        changed_files: number;
        additions: number;
        deletions: number;
    };
}

interface IssueCommentEvent {
    action: 'created';
    issue: {
        number: number;
        pull_request?: { url: string };
    };
    comment: {
        body: string;
        user: { login: string };
    };
    repository: { full_name: string };
}

interface ReviewResult {
    summary: string;
    architecture: { score: number; findings: string[] };
    security: { score: number; findings: string[] };
    patterns: { score: number; findings: string[] };
    suggestions: Array<{ file: string; line: number; suggestion: string }>;
    overallScore: number;
    confidence: number;
    sources: string[];
}

// ---------------------------------------------------------------------------
// Webhook Handler
// ---------------------------------------------------------------------------

class GitHubWebhookHandler {
    constructor(private config: GitHubWebhookConfig) { }

    /**
     * Handle incoming GitHub webhook events.
     */
    async handleWebhook(event: string, payload: unknown): Promise<void> {
        switch (event) {
            case 'pull_request':
                await this.handlePullRequest(payload as PullRequestEvent);
                break;
            case 'issue_comment':
                await this.handleComment(payload as IssueCommentEvent);
                break;
            default:
                console.log(`[GitHub] Ignoring event: ${event}`);
        }
    }

    // -------------------------------------------------------------------------
    // PR Auto-Review
    // -------------------------------------------------------------------------

    private async handlePullRequest(event: PullRequestEvent): Promise<void> {
        if (!this.config.autoReviewEnabled) return;
        if (event.action !== 'opened' && event.action !== 'synchronize') return;

        const pr = event.pull_request;

        // Check label filter
        if (this.config.reviewLabels.length > 0) {
            const hasLabel = pr.labels.some((l) => this.config.reviewLabels.includes(l.name));
            if (!hasLabel) return;
        }

        console.log(`[GitHub] Reviewing PR #${event.number}: ${pr.title}`);

        try {
            // Call EAOS Cognitive Engine
            const result = await this.callEAOS({
                goal: `Review pull request for architecture, security, and code patterns`,
                action: 'pr_review',
                subject: pr.html_url,
                context: {
                    repo: pr.base.repo.full_name,
                    prNumber: event.number,
                    title: pr.title,
                    description: pr.body,
                    branch: pr.head.ref,
                    baseBranch: pr.base.ref,
                    changedFiles: pr.changed_files,
                    additions: pr.additions,
                    deletions: pr.deletions,
                },
            });

            // Post review as PR comment
            const review = result as ReviewResult;
            const comment = this.formatReview(review, event.number);

            await this.postPRComment(
                pr.base.repo.full_name,
                event.number,
                comment
            );

            // Post inline suggestions
            for (const suggestion of review.suggestions) {
                await this.postInlineComment(
                    pr.base.repo.full_name,
                    event.number,
                    pr.head.sha,
                    suggestion
                );
            }
        } catch (error) {
            console.error(`[GitHub] Review failed for PR #${event.number}:`, error);
        }
    }

    // -------------------------------------------------------------------------
    // @eaos mentions in PR comments
    // -------------------------------------------------------------------------

    private async handleComment(event: IssueCommentEvent): Promise<void> {
        if (!event.issue.pull_request) return;
        if (!event.comment.body.includes('@eaos')) return;

        const question = event.comment.body.replace(/@eaos/g, '').trim();
        console.log(`[GitHub] @eaos asked in PR #${event.issue.number}: ${question}`);

        try {
            const result = await this.callEAOS({
                goal: question,
                action: 'pr_question',
                subject: `PR #${event.issue.number}`,
                context: {
                    repo: event.repository.full_name,
                    prNumber: event.issue.number,
                },
            });

            await this.postPRComment(
                event.repository.full_name,
                event.issue.number,
                `> ${question}\n\n${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`
            );
        } catch (error) {
            await this.postPRComment(
                event.repository.full_name,
                event.issue.number,
                `❌ EAOS could not process this request: ${(error as Error).message}`
            );
        }
    }

    // -------------------------------------------------------------------------
    // Formatting
    // -------------------------------------------------------------------------

    private formatReview(review: ReviewResult, prNumber: number): string {
        const scoreEmoji = (score: number) =>
            score >= 0.8 ? '🟢' : score >= 0.6 ? '🟡' : '🔴';

        return `## 🧠 EAOS Architecture Review — PR #${prNumber}

${review.summary}

### Scores

| Area | Score | Findings |
|------|-------|----------|
| Architecture | ${scoreEmoji(review.architecture.score)} ${(review.architecture.score * 100).toFixed(0)}% | ${review.architecture.findings.length} |
| Security | ${scoreEmoji(review.security.score)} ${(review.security.score * 100).toFixed(0)}% | ${review.security.findings.length} |
| Patterns | ${scoreEmoji(review.patterns.score)} ${(review.patterns.score * 100).toFixed(0)}% | ${review.patterns.findings.length} |
| **Overall** | ${scoreEmoji(review.overallScore)} **${(review.overallScore * 100).toFixed(0)}%** | |

### Findings

${review.architecture.findings.map((f) => `- 🏗️ ${f}`).join('\n')}
${review.security.findings.map((f) => `- 🔒 ${f}`).join('\n')}
${review.patterns.findings.map((f) => `- 📐 ${f}`).join('\n')}

---
*🎯 Confidence: ${(review.confidence * 100).toFixed(0)}% · 📖 Sources: ${review.sources.join(', ')}*
*Generated by EAOS Cognitive Engine*`;
    }

    // -------------------------------------------------------------------------
    // GitHub API
    // -------------------------------------------------------------------------

    private async callEAOS(request: Record<string, unknown>): Promise<unknown> {
        const res = await fetch(`${this.config.eaosGatewayUrl}/api/goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request),
        });

        if (!res.ok) throw new Error(`EAOS returned ${res.status}`);
        const result = await res.json() as { output: unknown };
        return result.output;
    }

    private get githubHeaders(): Record<string, string> {
        return {
            'Authorization': `Bearer ${this.config.githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'EAOS-Webhook/1.0',
            'Content-Type': 'application/json',
        };
    }

    private async postPRComment(repo: string, prNumber: number, body: string): Promise<void> {
        if (!this.config.githubToken) {
            throw new Error('GitHub token is required to post PR comments. Set the githubToken config.');
        }
        // GitHub REST API — POST /repos/{repo}/issues/{prNumber}/comments
        const res = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
            method: 'POST',
            headers: this.githubHeaders,
            body: JSON.stringify({ body }),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`GitHub API error ${res.status} posting comment on ${repo}#${prNumber}: ${errText}`);
        }
        console.log(`[GitHub] Posted review on ${repo}#${prNumber} (${body.length} chars)`);
    }

    private async postInlineComment(
        repo: string,
        prNumber: number,
        commitSha: string,
        suggestion: { file: string; line: number; suggestion: string }
    ): Promise<void> {
        if (!this.config.githubToken) {
            throw new Error('GitHub token is required to post inline comments. Set the githubToken config.');
        }
        // GitHub REST API — POST /repos/{repo}/pulls/{prNumber}/comments
        const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${prNumber}/comments`, {
            method: 'POST',
            headers: this.githubHeaders,
            body: JSON.stringify({
                body: suggestion.suggestion,
                commit_id: commitSha,
                path: suggestion.file,
                line: suggestion.line,
                side: 'RIGHT',
            }),
        });
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`GitHub API error ${res.status} posting inline comment on ${repo}#${prNumber} ${suggestion.file}:${suggestion.line}: ${errText}`);
        }
        console.log(`[GitHub] Inline comment on ${repo}#${prNumber} ${suggestion.file}:${suggestion.line}`);
    }
}

export { GitHubWebhookHandler };
export type { GitHubWebhookConfig, PullRequestEvent, IssueCommentEvent, ReviewResult };
