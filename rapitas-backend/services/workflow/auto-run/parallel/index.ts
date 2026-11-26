/**
 * parallel (barrel)
 *
 * Public API for running more than one auto-run task per theme (task 1552):
 * the running set, companion selection, the parallel-safety rules and the
 * per-task stop. Internal callers import the specific files directly so the
 * scheduler's lazy imports stay lazy; this barrel is for new code.
 */
export * from './parallel-types';
export { parseCompanions, serializeCompanions } from './companion-json';
export {
  activeTaskIds,
  addCompanion,
  loadThemeActiveSet,
  releaseThemeSlot,
  retrackThemeSlot,
  type SlotReleaseKind,
  type SlotReleaseOutcome,
} from './theme-active-set';
export {
  clearCompanions,
  promoteHeadless,
  releaseCompanionEverywhere,
} from './theme-active-set-cleanup';
export {
  CONFLICT_PRONE_FILE_RULES,
  collectPlanFiles,
  extractDependencyRefs,
  judgePair,
  type PairContext,
  type PairSide,
} from './parallel-safety-rules';
export { findImportRelation } from './import-relation';
export {
  normalizeWorkingDirectory,
  repositoryThemeIds,
  loadRepositoryPeerActiveTasks,
} from './repository-peers';
export { buildParallelFilter, logParallelRejections } from './parallel-filter';
export { selectCompanionTask } from './companion-selection';
export { buildHeadParallelFilter } from './head-parallel-filter';
export { stopAutoRunTaskOrTheme } from './per-task-stop';
export {
  delegateToCompanionSelection,
  effectivePerThemeLimit,
  advancePausedCompanions,
} from './companion-entry';
export { advanceCompanions } from './advance-companions';
