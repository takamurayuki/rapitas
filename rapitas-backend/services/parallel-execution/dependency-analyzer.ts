/**
 * DependencyAnalyzer (barrel)
 *
 * Re-exports the full public API from the dependency-analyzer sub-module.
 * Exists solely for backward compatibility — all new code should import
 * directly from ./dependency-analyzer/*.
 */

export { DependencyAnalyzer, createDependencyAnalyzer } from './dependency-analyzer/index';
export { extractFilePaths, getFileName, priorityToWeight } from './dependency-analyzer/utils';
export {
  topologicalSort,
  calculateCriticalPath,
  generateParallelGroups,
  detectCycles,
  calculateMaxDepth,
} from './dependency-analyzer/graph-algorithms';
export { buildExecutionPlan, detectResourceConstraints } from './dependency-analyzer/plan-builder';
