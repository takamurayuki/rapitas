/**
 * test-correlation (barrel)
 *
 * Re-exports the test-failure correlation heatmap's public service API:
 * types, run-history persistence, the correlation engine, PR risk scoring,
 * and the Slack/Discord notifier.
 */
export * from './test-correlation.types';
export * from './run-history-store';
export * from './correlation-engine';
export * from './pr-test-risk';
export * from './test-correlation-notifier';
export * from './failure-tail';
