/**
 * plan-deviation
 *
 * Barrel for the plan-vs-execution deviation timeline services.
 */
export * from './types';
export { parsePlanDeclaration, hashDeclaration, PLAN_DECLARATION_FENCE } from './declaration-parser';
export { normalizePath, matchesPattern, matchesAnyPattern } from './glob-match';
export { extractOperations, splitCommandNames, extractUrlHosts } from './operation-extractor';
export type { ExtractedOperation } from './operation-extractor';
export { classifyOperations, ALWAYS_ALLOWED_COMMANDS } from './classifier';
export { maskDeviationText } from './deviation-mask';
export {
  createOperationStore,
  getOperationStore,
  getDeviationDataDir,
  DEFAULT_MAX_OPERATION_LINES,
} from './operation-store';
export type { OperationStore, OperationStoreOptions } from './operation-store';
export { buildDeviationTimeline, isSupportedProvider, AMBIGUOUS_PLAN_WARNING } from './timeline-builder';
export { buildAuditRecord, appendDeviationAudit, listDeviationAudits } from './audit';
export {
  fetchLogContext,
  resolveContextWindow,
  DEFAULT_CONTEXT_LINES,
  MAX_CONTEXT_LINES,
} from './log-context';
export type { LogContextSource, ContextLine } from './log-context';
