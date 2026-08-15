// Re-export db for gateway
export { InMemoryStore, SessionRepository, ExecutionRepository } from '@agentos/db';
export type { SessionRecord, ExecutionRecord, Store } from '@agentos/db';
export { PersistentStore } from '@agentos/db/persistent-store';
export { PostgresStore } from '@agentos/db/postgres-store';
/**
 * Read a whole table from either store shape.
 *
 * `PostgresStore` implements `Store` but its `all()` THROWS — callers must use
 * `allAsync()`. Eight `init*Store()` functions called `all()` synchronously at
 * module load, so setting `DATABASE_URL` (the documented production config)
 * crashed the gateway during import. Always use this instead of `store.all()` on
 * a restore path.
 */
export { readAll } from '@agentos/db/create-store';

// Unified execution types
export type {
  UnifiedExecution,
  UnifiedStep,
  ExecutionEdge,
  AgentKPI as UnifiedAgentKPI,
  UnifiedSkillDef,
  SkillStepDef,
  SkillInputField as UnifiedSkillInputField,
  ExecutionMode,
  ExecutableType,
  PersonaId,
  ExecutionStatus as UnifiedExecutionStatus,
  StepStatus as UnifiedStepStatus,
  PreCheckResult,
  NotificationRecord,
} from '@agentos/db/unified-types';
