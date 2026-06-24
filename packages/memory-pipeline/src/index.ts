/**
 * @agentos/memory-pipeline — Package entrypoint
 */
export { MemoryPipeline, DEFAULT_PIPELINE_CONFIG } from './pipeline.js';
export type {
    RetrievalRequest, RetrievedDocument, RankedContext,
    MemoryPipelineConfig, VectorStore, KeywordIndex, KnowledgeGraphQuery,
} from './pipeline.js';

// EAOS agent memory schema (provenance: bytedance/deer-flow, MIT — see third_party/NOTICE).
export { createEmptyMemory } from './agent-memory-schema.js';
export type { AgentMemory, MemoryFact, MemorySummary } from './agent-memory-schema.js';
