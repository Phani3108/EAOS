/**
 * @agentos/secrets — Package entrypoint
 */
export { InMemoryVault, parseSecretUri } from './vault.js';
export { VaultKV2 } from './vault-kv2.js';
export { isOwnedSecretPath, isSecretOwnerSegment } from './namespace.js';
export type { VaultRequest } from './vault-kv2.js';
export type { SecretVault, SecretProvider, SecretReference, SecretValue, SecretAuditEntry } from './vault.js';
