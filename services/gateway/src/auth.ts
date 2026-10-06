// Re-export auth for gateway
export { authenticateRequest, requireRole, requirePersonaAccess, generateJWT, generateApiKey, setApiKeyResolver, setSessionResolver, hashApiKey, hashApiKeyCandidates, isDemoPrincipal, localDemoUser, DEMO_PRINCIPAL_PREFIX } from '@agentos/auth';
export type { AuthUser, AuthResult, UserRole, PersonaScope, GeneratedApiKey } from '@agentos/auth';
