/**
 * Task Complexity Analysis Service
 *
 * Re-exports all public symbols from the complexity-analyzer sub-modules.
 * Maintained for backward compatibility — consumers should prefer importing
 * from the sub-modules directly for tree-shaking benefits.
 */

export type { TaskComplexityInput, ComplexityAnalysisResult, LearningInsight } from './complexity-analyzer/types';
export {
  LIGHTWEIGHT_KEYWORDS,
  HEAVYWEIGHT_KEYWORDS,
  LIGHTWEIGHT_LABEL_KEYWORDS,
  HEAVYWEIGHT_LABEL_KEYWORDS,
} from './complexity-analyzer/types';

export {
  analyzeKeywords,
  analyzeEstimatedTime,
  analyzePriority,
  analyzeLabels,
  getRecommendedMode,
  calculateEstimatedExecutionTime,
  calculateConfidence,
} from './complexity-analyzer/analyzers';

export {
  analyzeTaskComplexity,
  analyzeBatchComplexity,
  getWorkflowModeConfig,
} from './complexity-analyzer/core';

export { analyzeTaskComplexityWithLearning } from './complexity-analyzer/learning';
