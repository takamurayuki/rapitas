/**
 * Cost Optimization Query — barrel
 *
 * Re-exports the public API of the cost-optimization module split across
 * types / cost-resolver / aggregation-query / suggestions.
 */

export type { ModelCostStats, CostOptimizationInsights } from './cost-optimization-types';
export { getCostOptimizationInsights } from './cost-optimization-query';
export { buildLegacySuggestions } from './cost-optimization-suggestions';
