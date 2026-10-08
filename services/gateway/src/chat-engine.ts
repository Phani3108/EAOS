/**
 * Chat Engine — Orchestrates multi-turn chat conversations.
 *
 * Takes a user message, classifies intent, and routes to one of three paths:
 *   1. Chat reply  — direct LLM call with conversation context
 *   2. Skill invocation — enqueue via task queue, attach execution as tool turn
 *   3. Delegation  — hand off to another agent via A2A
 *
 * Streams tokens back to WebSocket channel `chat:<sessionId>`.
 *
 * @author Phani Marupaka <https://linkedin.com/in/phani-marupaka>
 * @copyright © 2026 Phani Marupaka. All rights reserved.
 */

import { addMessage, buildConversationContext, getSession, usesDurableChat } from './chat-store.js';
import { callLLM } from './llm-provider.js';
import { resolveSimulate } from './run-mode.js';
import { broadcastEvent } from './ws.js';
import { eventBus } from './event-bus.js';
import { createUTCPPacket, storePacket } from './utcp-protocol.js';
import { intentEngine } from './intent-engine.js';
import { skillMarketplace } from './skill-marketplace.js';
import type { AuthUser } from './auth.js';
import type { ChatSession } from './chat-store.js';

let submitExecution: ((principal: AuthUser, session: ChatSession, content: string, conversation: string, messageId: string) => Promise<string>) | undefined;
export function configureChatExecutionAdapter(adapter: NonNullable<typeof submitExecution>): void { submitExecution = adapter; }

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface PostMessageResult {
    userMessage: { id: string; content: string; createdAt: string };
    replyPath: 'chat' | 'skill' | 'delegation' | 'error';
    agentMessage?: { id: string; content: string; createdAt: string };
    detectedSkillSlug?: string;
    detectedAgent?: string;
    executionId?: string;
    error?: string;
}

// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════

/**
 * Post a user message to a chat session and generate an agent reply.
 *
 * The reply path is auto-selected:
 *   - If the message contains `/skill-slug`, invoke that skill.
 *   - If the message contains `@agent-name`, delegate to that agent.
 *   - Otherwise, generate a direct chat reply using conversation context.
 */
export async function postMessage(params: {
    sessionId: string;
    userId: string;
    tenantId: string;
    content: string;
    principal?: AuthUser;
}): Promise<PostMessageResult> {
    const session = await getSession(params.sessionId, params);
    if (!session) {
        return {
            userMessage: { id: '', content: params.content, createdAt: new Date().toISOString() },
            replyPath: 'error',
            error: 'Session not found',
        };
    }

    // 1. Record the user message
    const userMsg = await addMessage({
        userId: params.userId, tenantId: params.tenantId,
        sessionId: params.sessionId,
        role: 'user',
        content: params.content,
    });
    if (!userMsg) {
        return {
            userMessage: { id: '', content: params.content, createdAt: new Date().toISOString() },
            replyPath: 'error',
            error: 'Failed to record user message',
        };
    }

    // Broadcast the user message to the chat channel
    broadcastEvent(`chat:${params.sessionId}`, 'chat.message', {
        role: 'user',
        message: userMsg,
    }, params.tenantId);

    // Chat offers no run-mode choice, so the shared rule decides (run-mode.ts):
    // a demo visitor, or a gateway with no LLM provider, gets a simulation. The
    // file store's direct reply below calls a provider with no budget at all, so
    // a simulated message takes the canonical execution path instead — a
    // labelled simulated run, never prose presented as the agent's answer.
    if (usesDurableChat() || resolveSimulate(params.userId)) {
        try {
            if (!submitExecution || !params.principal || params.principal.id !== params.userId || params.principal.tenantId !== params.tenantId) throw new Error('Verified chat execution context is required');
            const context = await buildConversationContext(params.sessionId, params, { maxMessages: 20 });
            if (!context) throw new Error('Chat context is unavailable');
            const conversation = context.messages.map(message => `${message.role}: ${message.content}`).join('\n\n');
            const executionId = await submitExecution(params.principal, session, params.content, conversation, userMsg.id);
            const ack = await addMessage({ ...params, role: 'tool', content: `Execution ${executionId} was queued. Results and approval state are available on the execution.`, attachments: [{ type: 'execution', ref: executionId, title: 'Open execution' }] });
            if (ack) broadcastEvent(`chat:${params.sessionId}`, 'chat.message', { role: 'tool', message: ack }, params.tenantId);
            return { userMessage: userMsg, replyPath: 'skill', executionId, agentMessage: ack };
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Chat execution was not accepted';
            const failure = await addMessage({ ...params, role: 'system', content: message });
            if (failure) broadcastEvent(`chat:${params.sessionId}`, 'chat.message', { role: 'system', message: failure }, params.tenantId);
            return { userMessage: userMsg, replyPath: 'error', error: message };
        }
    }

    // 2. Create a UTCP packet for audit uniformity
    if (!usesDurableChat()) try {
        const packet = createUTCPPacket({
            function: (session.persona as any) ?? 'engineering',
            stage: 'chat',
            intent: params.content.slice(0, 240),
            initiator: { user_id: params.userId, role: 'operator' },
            objectives: [params.content.slice(0, 100)],
        });
        storePacket(packet);
    } catch {}

    // 3. Classify intent — look for `/` commands or `@` mentions
    const commandMatch = params.content.match(/^\/([\w-]+)/);
    const mentionMatch = params.content.match(/@([\w-]+)/);

    // Path 1: /skill invocation
    if (commandMatch) {
        const slug = commandMatch[1]!;
        const result: PostMessageResult = {
            userMessage: { id: userMsg.id, content: userMsg.content, createdAt: userMsg.createdAt },
            replyPath: 'error',
            error: 'Structured skill inputs and a validated submission adapter are required',
            detectedSkillSlug: slug,
        };

        // For now, add a system message acknowledging the skill was requested.
        // Full skill enqueue path will be wired when chat→queue→skill loop is integrated.
        const ack = await addMessage({
        userId: params.userId, tenantId: params.tenantId,
            sessionId: params.sessionId,
            role: 'system',
            content: `Skill "${slug}" was not enqueued: structured inputs and a validated submission adapter are required.`,
        });
        if (ack) {
            broadcastEvent(`chat:${params.sessionId}`, 'chat.message', { role: 'system', message: ack }, params.tenantId);
        }

        // Fire an A2A-style event so Protocol Monitor can see it
        if (!usesDurableChat()) eventBus.emit('chat.skill.requested', { sessionId: params.sessionId, slug, userId: params.userId }).catch(() => {});

        return result;
    }

    // Path 2: @agent delegation
    if (mentionMatch) {
        const agentName = mentionMatch[1]!;
        const result: PostMessageResult = {
            userMessage: { id: userMsg.id, content: userMsg.content, createdAt: userMsg.createdAt },
            replyPath: 'error',
            error: 'Delegation requires a validated agent/task contract',
            detectedAgent: agentName,
        };

        const ack = await addMessage({
        userId: params.userId, tenantId: params.tenantId,
            sessionId: params.sessionId,
            role: 'system',
            content: `No delegation was started for @${agentName}: a validated agent/task contract is required.`,
        });
        if (ack) {
            broadcastEvent(`chat:${params.sessionId}`, 'chat.message', { role: 'system', message: ack }, params.tenantId);
        }
        if (!usesDurableChat()) eventBus.emit('chat.delegation.requested', { sessionId: params.sessionId, agentName, userId: params.userId }).catch(() => {});
        return result;
    }

    // Path 3: direct chat reply via LLM
    const context = await buildConversationContext(params.sessionId, params, { maxMessages: 20 });
    if (!context) {
        return {
            userMessage: { id: userMsg.id, content: userMsg.content, createdAt: userMsg.createdAt },
            replyPath: 'error',
            error: 'Failed to build context',
        };
    }

    // Call LLM with concatenated conversation history as the user prompt
    const conversationText = context.messages
        .map(m => `${m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : 'System'}: ${m.content}`)
        .join('\n\n');

    let reply: string;
    try {
        if (usesDurableChat()) throw new Error('Durable chat replies require the canonical execution adapter; no provider was called');
        const llmResponse = await callLLM({
            systemPrompt: context.systemPrompt,
            userPrompt: conversationText,
            maxTokens: 1024,
            temperature: 0.7,
        });
        if (!llmResponse.content?.trim()) throw new Error('Provider returned no chat content');
        reply = llmResponse.content;

        const agentMsg = await addMessage({
        userId: params.userId, tenantId: params.tenantId,
            sessionId: params.sessionId,
            role: 'agent',
            agentId: session.agentId,
            content: reply,
            tokenCost: llmResponse.cost,
        });
        if (agentMsg) {
            broadcastEvent(`chat:${params.sessionId}`, 'chat.message', { role: 'agent', message: agentMsg }, params.tenantId);
        }

        return {
            userMessage: { id: userMsg.id, content: userMsg.content, createdAt: userMsg.createdAt },
            replyPath: 'chat',
            agentMessage: agentMsg ? { id: agentMsg.id, content: agentMsg.content, createdAt: agentMsg.createdAt } : undefined,
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error('[chat-engine] LLM call failed:', errorMsg);
        const sysMsg = await addMessage({
        userId: params.userId, tenantId: params.tenantId,
            sessionId: params.sessionId,
            role: 'system',
            content: `Error generating reply: ${errorMsg}`,
        });
        if (sysMsg) {
            broadcastEvent(`chat:${params.sessionId}`, 'chat.message', { role: 'system', message: sysMsg }, params.tenantId);
        }
        return {
            userMessage: { id: userMsg.id, content: userMsg.content, createdAt: userMsg.createdAt },
            replyPath: 'error',
            error: errorMsg,
        };
    }
}

/** Suggest a skill based on message content (uses existing intent engine). */
export function suggestSkillFromMessage(content: string): string | undefined {
    try {
        const result = intentEngine.routeIntent(content);
        return result?.skill?.slug;
    } catch {
        return undefined;
    }
}
