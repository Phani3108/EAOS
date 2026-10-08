// Re-export auth for gateway
export { authenticateRequest, requireRole, requirePersonaAccess, generateJWT, generateApiKey, setApiKeyResolver, setSessionResolver, hashApiKey, hashApiKeyCandidates, isDemoPrincipal, isDemoVisitor, demoPrincipalPermitted, localDemoUser, DEMO_PRINCIPAL_PREFIX, LOCAL_DEMO_PRINCIPAL_ID, DEMO_DISABLED_ERROR } from '@agentos/auth';
export type { AuthUser, AuthResult, UserRole, PersonaScope, GeneratedApiKey, LocalDemoVerdict, AuthenticateOptions } from '@agentos/auth';
