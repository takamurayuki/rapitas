/**
 * Cost Optimization Query Types
 *
 * Shared type definitions for the cost-optimization aggregation and
 * suggestion-generation modules.
 */

/** Per-model breakdown of execution cost, volume, and success rate. */
export interface ModelCostStats {
  model: string;
  executions: number;
  successCount: number;
  successRate: number;
  totalTokens: number;
  avgTokens: number;
  avgTimeMs: number;
  estimatedCost: number;
}

export interface CostOptimizationInsights {
  totalCost: number;
  totalTokens: number;
  totalExecutions: number;
  modelBreakdown: ModelCostStats[];
  suggestions: string[];
}

export type ComplexityBand = 'low' | 'medium' | 'high';

export interface ComparableExecution {
  status: string;
  modelName: string | null;
  tokensUsed: unknown;
  costUsd: unknown;
  executionTimeMs: unknown;
  session?: {
    mode: string | null;
    config: { task: { complexityScore: number | null } };
  } | null;
}

export interface SegmentModelStats {
  role: string;
  complexityBand: ComplexityBand;
  model: string;
  executions: number;
  successCount: number;
  totalCost: number;
}
