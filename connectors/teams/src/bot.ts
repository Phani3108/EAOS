/**
 * EAOS Teams Bot — Microsoft Teams integration
 *
 * @eaos mentions in Teams channels, 1:1 conversations,
 * and adaptive card responses with structured outputs.
 */

interface TeamsBotConfig {
    appId: string;
    appPassword: string;
    eaosGatewayUrl: string;
}

interface TeamsActivity {
    type: 'message';
    text: string;
    from: { id: string; name: string };
    channelId: string;
    conversation: { id: string };
    serviceUrl: string;
}

class EAOSTeamsBot {
    constructor(private config: TeamsBotConfig) { }

    async start(): Promise<void> {
        // The Bot Framework adapter / turn handler that delivers Teams activities to
        // handleMessage() is NOT wired up here. handleMessage() works if you call it
        // directly, but nothing receives Teams events or sends activities back to the
        // service URL yet — so this bot does not actually run. Report that honestly
        // instead of claiming the bot is "ready".
        //
        // To make it ready: initialize a BotFrameworkAdapter with appId/appPassword,
        // register a turn handler that routes message activities to handleMessage(),
        // and start an HTTP server that forwards /api/messages to the adapter.
        console.warn(
            '💬 EAOS Teams Bot: Bot Framework adapter not configured — ' +
            'no turn handler / HTTP listener wired up.'
        );
        throw new Error(
            'Teams not implemented — wire Bot Framework adapter ' +
            '(initialize BotFrameworkAdapter + turn handler + /api/messages listener before calling start())'
        );
    }

    /**
     * Handle incoming Teams message.
     */
    async handleMessage(activity: TeamsActivity): Promise<string> {
        const text = activity.text.replace(/<at>.*?<\/at>/g, '').trim();

        if (!text || text === 'help') {
            return this.getHelpCard();
        }

        // Send to EAOS
        try {
            const res = await fetch(`${this.config.eaosGatewayUrl}/api/goals`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    goal: text,
                    context: {
                        source: 'teams',
                        user: activity.from.name,
                        channel: activity.channelId,
                    },
                }),
            });

            if (!res.ok) throw new Error(`EAOS: ${res.status}`);
            const result = await res.json() as { output: unknown; confidence?: number };

            return this.formatAdaptiveCard(result);
        } catch (error) {
            return `❌ ${(error as Error).message}`;
        }
    }

    /**
     * Format result as Teams Adaptive Card JSON.
     */
    private formatAdaptiveCard(result: { output: unknown; confidence?: number }): string {
        // Adaptive Card schema for rich rendering in Teams
        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.4',
            body: [
                { type: 'TextBlock', text: '🧠 EAOS Result', weight: 'Bolder', size: 'Medium' },
                {
                    type: 'TextBlock',
                    text: typeof result.output === 'string'
                        ? result.output
                        : JSON.stringify(result.output, null, 2),
                    wrap: true,
                },
                {
                    type: 'FactSet',
                    facts: [
                        { title: 'Confidence', value: `${((result.confidence ?? 0) * 100).toFixed(0)}%` },
                    ],
                },
            ],
        };

        return JSON.stringify(card);
    }

    private getHelpCard(): string {
        return `🧠 **EAOS — Enterprise Agent OS**

**Try:**
- \`analyze incident INC-123\`
- \`review PR #456\`
- \`campaign targeting credit unions\`
- \`how does card auth work\`
- \`summarize today's standup\``;
    }
}

export { EAOSTeamsBot };
export type { TeamsBotConfig, TeamsActivity };
