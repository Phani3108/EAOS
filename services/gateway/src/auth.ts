// Re-export auth for gateway
export { authenticateRequest, requireRole, requirePersonaAccess, generateJWT, generateApiKey, setApiKeyResolver, setSessionResolver, hashApiKey, hashApiKeyCandidates } from '@agentos/auth';
export type { AuthUser, AuthResult, UserRole, PersonaScope, GeneratedApiKey } from '@agentos/auth';
