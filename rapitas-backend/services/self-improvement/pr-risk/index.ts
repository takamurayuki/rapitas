/**
 * pr-risk
 *
 * PR merge-failure risk prediction (task #1031): strict failure labels,
 * linear model + exact SHAP explanations, staged rollout gate and the monthly
 * precision/recall/FPR + threshold review loop.
 */
export * from './pr-risk-types';
export { extractFeatures, fetchPrSnapshot, parseRepoFromUrl } from './pr-risk-features';
export { PRIOR_MODEL, parseModel, predict, train } from './pr-risk-model';
export { classifyOutcome, collectOutcomes, matchesRevert } from './pr-risk-outcome';
export {
  computeMonthlyMetric,
  proposeThreshold,
  shouldAdopt,
  shouldDemote,
} from './pr-risk-metrics';
export { buildRiskComment, upsertRiskComment, HUMAN_NOTICE } from './pr-risk-comment';
export { readConfig, writeConfig, type PrRiskDb } from './pr-risk-store';
export { evaluatePrRisk } from './pr-risk-gate';
export { runPrRiskReviewJob } from './pr-risk-review-job';
