/**
 * EAOS Slack Bot — Makes EAOS live inside Slack
 *
 * Users interact with EAOS where they already work:
 *
 *   @eaos analyze incident INC-123
 *   @eaos review PR #456
 *   @eaos summarize this thread
 *   @eaos campaign targeting credit unions
 *   @eaos what did Ramki say about observability
 *
 * This is the #1 adoption driver. If EAOS is a "separate tool", nobody uses it.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SlackBotConfig {
    botToken: string;
    signingSecret: string;
    appToken: string;
    eaosGatewayUrl: string;
}

interface SlackCommand {
    command: string;
    text: string;
    userId: string;
    channelId: string;
    threadTs?: string;
    teamId: string;
}

interface SlackMessageEvent {
    type: 'app_mention' | 'message';
    text: string;
    user: string;
    channel: string;
    ts: string;
    threadTs?: string;
    teamId: string;
}

// ---------------------------------------------------------------------------
// Command Parser
// ---------------------------------------------------------------------------

interface ParsedIntent {
    action: string;
    subject: string;
    context: Record<string, string>;
    raw: string;
}

function parseIntent(text: string): ParsedIntent {
    // Remove bot mention
    const clean = text.replace(/<@[A-Z0-9]+>/g, '').trim();

    // Match common patterns
    const patterns: Array<{ regex: RegExp; action: string; subjectGroup: number }> = [
        { regex: /^analyze\s+incident\s+(.+)/i, action: 'incident_analysis', subjectGroup: 1 },
        { regex: /^review\s+pr\s+#?(\d+)/i, action: 'pr_review', subjectGroup: 1 },
        { regex: /^review\s+(https:\/\/github\.com\/.+)/i, action: 'pr_review', subjectGroup: 1 },
        { regex: /^summarize\s+(.+)/i, action: 'summarize', subjectGroup: 1 },
        { regex: /^campaign\s+(.+)/i, action: 'campaign', subjectGroup: 1 },
        { regex: /^runbook\s+(.+)/i, action: 'runbook', subjectGroup: 1 },
        { regex: /^what\s+did\s+(\w+)\s+say\s+about\s+(.+)/i, action: 'transcript_search', subjectGroup: 0 },
        { regex: /^how\s+does\s+(.+)\s+work/i, action: 'knowledge_search', subjectGroup: 1 },
        { regex: /^status$/i, action: 'status', subjectGroup: 0 },
        { regex: /^help$/i, action: 'help', subjectGroup: 0 },
        { regex: /^capabilities$/i, action: 'capabilities', subjectGroup: 0 },
    ];

    for (const pattern of patterns) {
        const match = clean.match(pattern.regex);
        if (match) {
            return {
                action: pattern.action,
                subject: match[pattern.subjectGroup] ?? clean,
                context: {},
                raw: clean,
            };
        }
    }

    // Default: general query
    return { action: 'general', subject: clean, context: {}, raw: clean };
}

// ---------------------------------------------------------------------------
// Slack Bot Service
// ---------------------------------------------------------------------------

class EAOSSlackBot {
    private config: SlackBotConfig;

    constructor(config: SlackBotConfig) {
        this.config = config;
    }

    async start(): Promise<void> {
        // Inbound event handling (Slack Bolt app / socket mode / HTTP server) is NOT
        // wired up here. The outbound helpers (sendMessage/updateMessage/sendReaction)
        // and the handleMention/handleSlashCommand handlers work, but nothing delivers
        // Slack events to them yet — so this bot is outbound-only. Report that honestly
        // instead of claiming the bot is "ready" to receive mentions.
        //
        // To make it inbound-ready: initialize a Slack Bolt app, register event
        // listeners that call handleMention/handleSlashCommand, and start socket mode
        // or an HTTP server.
        console.warn(
            '🤖 EAOS Slack Bot: inbound events not configured — outbound only ' +
            '(no Bolt app / socket mode / HTTP listener wired up).'
        );
        throw new Error(
            'Slack bot inbound events not configured — outbound only ' +
            '(wire up a Slack Bolt app / socket mode / HTTP listener before calling start())'
        );
    }

    /**
     * Handle an @eaos mention in Slack.
     */
    async handleMention(event: SlackMessageEvent): Promise<void> {
        const intent = parseIntent(event.text);

        // Acknowledge immediately with typing indicator
        await this.sendReaction(event.channel, event.ts, 'brain');

        // Send initial progress message
        const progressTs = await this.sendMessage(
            event.channel,
            `🧠 *Processing:* ${intent.action.replace('_', ' ')}...\n> ${intent.subject}`,
            event.ts
        );

        try {
            // Route to EAOS Gateway
            const result = await this.executeGoal(intent, event);

            // Update with structured result
            await this.updateMessage(event.channel, progressTs, this.formatResult(result));

            // Add completion reaction
            await this.sendReaction(event.channel, event.ts, 'white_check_mark');
        } catch (error) {
            await this.updateMessage(
                event.channel,
                progressTs,
                `❌ Failed: ${(error as Error).message}\n\nTry \`@eaos help\` for available commands.`
            );
        }
    }

    /**
     * Handle slash commands (/eaos).
     */
    async handleSlashCommand(command: SlackCommand): Promise<string> {
        const intent = parseIntent(command.text);

        if (intent.action === 'help') {
            return this.getHelpText();
        }

        if (intent.action === 'capabilities') {
            return this.getCapabilitiesText();
        }

        if (intent.action === 'status') {
            return await this.getStatusText();
        }

        // Execute asynchronously and respond in channel
        this.executeGoal(intent, {
            type: 'app_mention',
            text: command.text,
            user: command.userId,
            channel: command.channelId,
            ts: '',
            teamId: command.teamId,
        }).then(async (result) => {
            await this.sendMessage(
                command.channelId,
                this.formatResult(result),
                command.threadTs
            );
        }).catch(async (err) => {
            await this.sendMessage(
                command.channelId,
                `❌ ${(err as Error).message}`,
                command.threadTs
            );
        });

        return `🧠 Working on it... _${intent.action.replace('_', ' ')}_`;
    }

    // -------------------------------------------------------------------------
    // EAOS Integration
    // -------------------------------------------------------------------------

    private async executeGoal(
        intent: ParsedIntent,
        event: SlackMessageEvent
    ): Promise<CognitiveResult> {
        const response = await fetch(`${this.config.eaosGatewayUrl}/api/goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                goal: intent.raw,
                action: intent.action,
                subject: intent.subject,
                context: {
                    ...intent.context,
                    source: 'slack',
                    channel: event.channel,
                    user: event.user,
                },
                options: { urgency: 'high' },
            }),
        });

        if (!response.ok) {
            throw new Error(`EAOS returned ${response.status}`);
        }

        return response.json() as Promise<CognitiveResult>;
    }

    // -------------------------------------------------------------------------
    // Formatting — Structured, not essays
    // -------------------------------------------------------------------------

    private formatResult(result: CognitiveResult): string {
        const output = result.output as Record<string, unknown>;
        const lines: string[] = [];

        // Title
        if (output.title) {
            lines.push(`*${output.title}*\n`);
        }

        // Structured sections
        if (output.sections) {
            for (const section of output.sections as Array<{ heading: string; content: string }>) {
                lines.push(`*${section.heading}*`);
                lines.push(section.content);
                lines.push('');
            }
        } else if (typeof output.summary === 'string') {
            lines.push(output.summary);
            lines.push('');
        } else {
            lines.push(JSON.stringify(output, null, 2));
        }

        // Confidence + Sources (TRUST)
        lines.push('---');
        lines.push(`🎯 *Confidence:* ${((result.confidence ?? 0) * 100).toFixed(0)}%`);

        if (result.grounded) {
            lines.push(`✅ *Grounded:* ${((result.groundingScore ?? 0) * 100).toFixed(0)}%`);
        } else {
            lines.push('⚠️ *Some claims could not be verified against sources*');
        }

        // Sources
        const sources = (output.sources ?? []) as Array<{ title: string; url?: string }>;
        if (sources.length > 0) {
            lines.push('\n*📖 Sources:*');
            for (const src of sources) {
                lines.push(`• ${src.url ? `<${src.url}|${src.title}>` : src.title}`);
            }
        }

        return lines.join('\n');
    }

    // -------------------------------------------------------------------------
    // Help & Capabilities
    // -------------------------------------------------------------------------

    private getHelpText(): string {
        return `🧠 *EAOS — Enterprise Agent OS*

*Engineering*
\`@eaos analyze incident INC-123\` — Root cause analysis
\`@eaos review PR #456\` — Architecture review
\`@eaos runbook for payments-api\` — Generate runbook
\`@eaos how does card auth work\` — Knowledge search

*Marketing*
\`@eaos campaign targeting credit unions\` — Campaign strategy
\`@eaos newsletter\` — Generate weekly newsletter

*Leadership*
\`@eaos summarize office hours\` — Meeting summary
\`@eaos what did Ramki say about observability\` — Transcript search

*System*
\`@eaos capabilities\` — What EAOS can do
\`@eaos status\` — System health`;
    }

    private getCapabilitiesText(): string {
        return `🎯 *EAOS Capabilities*

*Engineering*
• Incident triage & root cause analysis
• PR architecture review
• Runbook generation
• Developer knowledge search

*Marketing*
• Campaign strategy (ICP → Messaging → Channels → Calendar)
• SEO content optimization
• Newsletter generation

*Leadership*
• Strategic decision analysis (SWOT, scenarios)
• Executive briefing
• Meeting/office hours summarization
• Transcript intelligence`;
    }

    private async getStatusText(): Promise<string> {
        try {
            const res = await fetch(`${this.config.eaosGatewayUrl}/health`);
            return res.ok ? '✅ EAOS is healthy and running' : `⚠️ EAOS returned status ${res.status}`;
        } catch {
            return '❌ EAOS is unreachable';
        }
    }

    // -------------------------------------------------------------------------
    // Slack API Helpers
    // -------------------------------------------------------------------------

    private async sendMessage(channel: string, text: string, threadTs?: string): Promise<string> {
        const res = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.botToken}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({
                channel,
                text,
                ...(threadTs ? { thread_ts: threadTs } : {}),
            }),
        });
        const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
        if (!data.ok) console.error(`[Slack] postMessage error: ${data.error}`);
        return data.ts ?? '';
    }

    private async updateMessage(channel: string, ts: string, text: string): Promise<void> {
        const res = await fetch('https://slack.com/api/chat.update', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.botToken}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({ channel, ts, text }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok) console.error(`[Slack] chat.update error: ${data.error}`);
    }

    private async sendReaction(channel: string, ts: string, emoji: string): Promise<void> {
        const res = await fetch('https://slack.com/api/reactions.add', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.botToken}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify({ channel, timestamp: ts, name: emoji }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        if (!data.ok && data.error !== 'already_reacted') {
            console.error(`[Slack] reactions.add error: ${data.error}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Types from Cognitive Engine
// ---------------------------------------------------------------------------

interface CognitiveResult {
    output: unknown;
    confidence?: number;
    grounded?: boolean;
    groundingScore?: number;
}

export { EAOSSlackBot, parseIntent };
export type { SlackBotConfig, SlackCommand, SlackMessageEvent, ParsedIntent };
