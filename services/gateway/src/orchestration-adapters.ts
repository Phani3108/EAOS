import type { AuthUser } from './auth.js';
import { requirePersonaAccess } from './auth.js';
import type { ChatSession } from './chat-store.js';
import { getAgentIdentity, getAgentsByPersona } from './agent-registry.js';
import { compileDefinition, getCompiledDefinition, requiredPersonas } from './definition-registry.js';
import { createPersonaExecution } from './persona-api.js';
import type { WorkflowPersona } from '@agentos/skills/schema';

export async function submitChatExecution(principal: AuthUser, session: ChatSession, content: string, conversation: string, messageId: string): Promise<string> {
    if (session.userId !== principal.id || session.tenantId !== principal.tenantId) throw new Error('Chat principal does not own this session');
    const persona = session.persona ?? 'engineering';
    if (!requirePersonaAccess(principal, persona)) throw new Error('Chat persona access denied');
    const command = content.match(/^\/([\w-]+)(?:\s+([\s\S]+))?$/);
    let definition;
    let inputs: Record<string, unknown>;
    if (command) {
        definition = getCompiledDefinition(command[1]!, persona);
        if (!definition) throw new Error('Unknown canonical skill command');
        inputs = command[2] ? JSON.parse(command[2]) : {};
        if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) throw new Error('Skill commands require a JSON input object');
    } else {
        if (conversation.length > 100_000) throw new Error('Conversation exceeds the execution context bound');
        const mention = content.match(/^@([\w-]+)/)?.[1];
        const requested = mention ?? session.agentId;
        const agent = requested ? getAgentIdentity(requested) : persona === 'program' ? getAgentIdentity('pmo-director') : getAgentsByPersona(persona === 'ta' ? 'hr' : persona)[0];
        if (!agent || !(agent.persona === persona || persona === 'ta' && agent.persona === 'hr' || persona === 'program' && agent.id === 'pmo-director')) throw new Error('Agent is not a known member of the chat persona');
        definition = compileDefinition({
            id: `chat-${persona}-${agent.id}`, slug: `chat-${agent.id}`, name: `Chat with ${agent.callSign}`, description: 'Tenant-owned conversation response', icon: '',
            persona: persona as WorkflowPersona, executableType: 'skill', cluster: 'Conversation', complexity: 'moderate', estimatedTime: '',
            inputs: [{ id: 'conversation', label: 'Conversation', type: 'textarea', required: true, section: 'basic' }],
            steps: [{ id: 'reply', order: 1, name: 'Respond to conversation', agent: agent.id, agentPersona: persona, tool: 'llm', kind: 'llm', outputKey: 'reply' }],
            outputs: ['reply'], requiredTools: ['llm'], optionalTools: [], tags: ['conversation'],
        });
        inputs = { conversation };
    }
    if (requiredPersonas(definition).some(persona => !requirePersonaAccess(principal, persona))) throw new Error('Skill command requires additional persona permissions');
    const execution = await createPersonaExecution(principal.tenantId, definition.persona, definition, inputs, principal.id, false, undefined, undefined, undefined, `chat:${session.sessionId}:${messageId}`);
    return execution.id;
}
