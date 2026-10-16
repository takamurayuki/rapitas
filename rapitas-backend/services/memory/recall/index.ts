/**
 * recall (barrel)
 *
 * Public surface of the hybrid knowledge-recall subsystem: the search entry
 * point, its configuration, the attempt metrics, and the lexical-index cache
 * invalidation hook used by knowledge writes.
 */
export { searchKnowledgeHybrid } from './hybrid-search';
export type { HybridHit, HybridSearchOptions, RecallSource } from './hybrid-search';
export { getRecallConfig, parseRecallConfig, resetRecallConfigCache } from './recall-config';
export type { RecallConfig } from './recall-config';
export { getRecallMetrics, aggregateRecallMetrics } from './recall-metrics';
export type { RecallMetrics } from './recall-metrics';
export { invalidateLexicalIndex } from './lexical-index';
