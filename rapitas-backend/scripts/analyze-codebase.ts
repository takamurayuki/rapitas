/**
 * analyze-codebase
 *
 * Entry point shim — delegates to the split sub-modules under
 * ./analyze-codebase/. Kept at this path for backward compatibility
 * (bun run scripts/analyze-codebase.ts still works).
 *
 * All implementation lives in rapitas-backend/scripts/analyze-codebase/.
 */

// NOTE: Bun executes this file directly when using `bun run analyze-codebase.ts`.
// Re-exporting public types allows other scripts to import from the original path.
export type { AnalysisResult, FileInfo, FeatureArea } from './analyze-codebase/types';
export { FEATURE_AREAS_CONFIG } from './analyze-codebase/metrics/test-coverage';
export { walkDir } from './analyze-codebase/file-walker';
export { collectCodeMetrics } from './analyze-codebase/metrics/code-metrics';
export { collectArchitectureMetrics } from './analyze-codebase/metrics/architecture-metrics';
export { collectQualityMetrics } from './analyze-codebase/metrics/quality-metrics';
export { collectComplexityMetrics } from './analyze-codebase/metrics/complexity-metrics';
export { collectSecurityFindings } from './analyze-codebase/metrics/security-metrics';
export { collectImportMetrics } from './analyze-codebase/metrics/import-metrics';
export { collectAPIConsistency } from './analyze-codebase/metrics/api-consistency';
export { collectTestCoverage } from './analyze-codebase/metrics/test-coverage';
export { collectArchitectureHealth } from './analyze-codebase/metrics/architecture-health';
export { collectAIAgentMetrics, collectDependencyMetrics } from './analyze-codebase/metrics/ai-agent-metrics';
export { collectFeatureCompleteness } from './analyze-codebase/metrics/feature-completeness';
export { collectMaintainabilityMetrics } from './analyze-codebase/metrics/maintainability-metrics';
export { computeScoring } from './analyze-codebase/scoring';
export { generateMarkdownReport } from './analyze-codebase/report-generator';

// NOTE: When this file is executed directly by Bun (bun run analyze-codebase.ts),
// index.ts is the authoritative entry point. This import triggers main() only
// when the shim itself is the program entry (import.meta.main).
// Importing the shim as a library will still run main(); prefer importing from
// ./analyze-codebase/* sub-modules directly if you need library access only.
if (import.meta.main) {
  await import('./analyze-codebase/index');
}
