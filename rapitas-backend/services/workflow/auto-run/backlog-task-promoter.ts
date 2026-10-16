/**
 * backlog-task-promoter
 *
 * Barrel re-exporting backlog-refill eligibility (hasPromotableBacklog) and
 * execution (promoteBacklogForTheme). Split into backlog-promoter-eligibility
 * / -execute (task 784) to stay under the file-size ratchet — import paths
 * through this barrel are unaffected. NOT responsible for selecting/executing
 * the created tasks — the scheduler re-selects after promotion returns.
 */
export * from './backlog-promoter-eligibility';
export * from './backlog-promoter-execute';
