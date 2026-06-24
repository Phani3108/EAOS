/**
 * @agentos/connector-slack — Slack Connector
 *
 * Real Slack Web API integration for AgentOS workers.
 * Uses Bot Token for outbound actions.
 * Event handlers store callbacks — caller wires them to Socket Mode or HTTP events.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackConfig {
    botToken: string;
    appToken?: string;
    signingSecret: string;
}

export interface SlackMessage {
    channel: string;
    text: string;
    threadTs?: string;
    blocks?: unknown[];
}

interface SlackApiResponse {
    ok: boolean;
    error?: string;
    ts?: string;
    channel?: string;
    [key: string]: unknown;
}

export interface SlackMessageEvent {
    channel: string;
    text: string;
    user: string;
    ts: string;
    thread_ts?: string;
}

// ---------------------------------------------------------------------------
// Slack Web API helper
// ---------------------------------------------------------------------------

const SLACK_API = 'https://slack.com/api';

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

export class SlackConnector {
    private config: SlackConfig;
    private messageHandlers: Array<(event: SlackMessageEvent) => void> = [];
    private mentionHandlers: Array<(event: { channel: string; text: string; user: string }) => void> = [];
    private reactionHandlers: Array<(event: { channel: string; reaction: string; user: string; itemTs: string }) => void> = [];

    constructor(config: SlackConfig) {
        this.config = config;
    }

    private async api(method: string, body: Record<string, unknown>): Promise<SlackApiResponse> {
        const res = await fetch(`${SLACK_API}/${method}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.botToken}`,
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(body),
        });
        const data = (await res.json()) as SlackApiResponse;
        if (!data.ok) {
            throw new Error(`Slack API ${method} error: ${data.error}`);
        }
        return data;
    }

    // -----------------------------------------------------------------------
    // Connection lifecycle
    // -----------------------------------------------------------------------

    async connect(): Promise<{ botId: string; teamId: string }> {
        const data = await this.api('auth.test', {});
        const botId = data.user_id as string;
        const teamId = data.team_id as string;
        console.log(`💬 Slack connected: bot=${botId} team=${teamId}`);
        return { botId, teamId };
    }

    async disconnect(): Promise<void> {
        this.messageHandlers = [];
        this.mentionHandlers = [];
        this.reactionHandlers = [];
    }

    // -----------------------------------------------------------------------
    // Outbound Actions
    // -----------------------------------------------------------------------

    async postMessage(message: SlackMessage): Promise<{ ts: string; channel: string }> {
        const data = await this.api('chat.postMessage', {
            channel: message.channel,
            text: message.text,
            ...(message.threadTs ? { thread_ts: message.threadTs } : {}),
            ...(message.blocks ? { blocks: message.blocks } : {}),
        });
        return { ts: data.ts as string, channel: data.channel as string };
    }

    async updateMessage(channel: string, ts: string, text: string, blocks?: unknown[]): Promise<void> {
        await this.api('chat.update', {
            channel,
            ts,
            text,
            ...(blocks ? { blocks } : {}),
        });
    }

    async addReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
        await this.api('reactions.add', {
            channel,
            timestamp,
            name: emoji,
        });
    }

    async removeReaction(channel: string, timestamp: string, emoji: string): Promise<void> {
        await this.api('reactions.remove', {
            channel,
            timestamp,
            name: emoji,
        });
    }

    async sendDM(userId: string, text: string): Promise<{ ts: string }> {
        // Open a DM conversation first
        const conv = await this.api('conversations.open', { users: userId });
        const channelId = (conv.channel as unknown as { id: string }).id;
        return this.postMessage({ channel: channelId, text });
    }

    async uploadFile(channels: string, content: string, filename: string, title?: string): Promise<void> {
        await this.api('files.uploadV2', {
            channels,
            content,
            filename,
            title: title ?? filename,
        });
    }

    // -----------------------------------------------------------------------
    // Channel info
    // -----------------------------------------------------------------------

    async getChannels(limit = 200): Promise<{ id: string; name: string }[]> {
        const data = await this.api('conversations.list', {
            types: 'public_channel,private_channel',
            limit,
            exclude_archived: true,
        });
        return (data.channels as { id: string; name: string }[]) ?? [];
    }

    async getUserInfo(userId: string): Promise<{ id: string; name: string; real_name: string }> {
        const data = await this.api('users.info', { user: userId });
        return data.user as { id: string; name: string; real_name: string };
    }

    // -----------------------------------------------------------------------
    // Inbound Events — register handlers, dispatch from event API
    // -----------------------------------------------------------------------

    onMessage(handler: (event: SlackMessageEvent) => void): void {
        this.messageHandlers.push(handler);
    }

    onMention(handler: (event: { channel: string; text: string; user: string }) => void): void {
        this.mentionHandlers.push(handler);
    }

    onReaction(handler: (event: { channel: string; reaction: string; user: string; itemTs: string }) => void): void {
        this.reactionHandlers.push(handler);
    }

    /**
     * Dispatch an incoming Slack event to registered handlers.
     * Call this from your HTTP event endpoint or Socket Mode listener.
     */
    dispatchEvent(type: string, event: Record<string, unknown>): void {
        switch (type) {
            case 'message':
                for (const h of this.messageHandlers) {
                    h(event as unknown as SlackMessageEvent);
                }
                break;
            case 'app_mention':
                for (const h of this.mentionHandlers) {
                    h(event as { channel: string; text: string; user: string });
                }
                break;
            case 'reaction_added':
                for (const h of this.reactionHandlers) {
                    h(event as { channel: string; reaction: string; user: string; itemTs: string });
                }
                break;
        }
    }
}

export default SlackConnector;
