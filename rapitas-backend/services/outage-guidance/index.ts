/**
 * outage-guidance
 *
 * Barrel for the dependency-graph based outage guidance (stop-impact verdicts,
 * evidence paths, Slack notification and back-testing).
 */
export * from './outage-guidance.types';
export { computeImpact, buildReverseAdjacency } from './dependency-graph';
export {
  classifyOutage,
  evaluateOutage,
  estimateRecovery,
  computeBlastRatio,
  percentileNearestRank,
  toleranceFor,
} from './outage-classifier';
export {
  loadInventory,
  validateInventory,
  resolveInventoryPath,
  clearInventoryCache,
  InventoryNotFoundError,
  InventoryValidationError,
} from './inventory-loader';
export {
  assessOutage,
  assessOutageInInventory,
  ServiceNotFoundError,
} from './outage-assessment-service';
export { simulate, expectedVerdict } from './outage-simulation';
export {
  buildOutageSlackPayload,
  buildSimulationSlackPayload,
  sendOutageSlack,
  resolveSlackWebhookUrl,
  VERDICT_LABELS,
  MAX_SLACK_PATHS,
} from './outage-slack-notifier';
export { runOutageSimulationJob } from './outage-simulation-job';
