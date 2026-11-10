/**
 * review-cost-rows
 *
 * Identity of the AgentExecution rows that only carry the cost of an
 * auxiliary review call (the adversarial diff-review jury), and the Prisma
 * filter that keeps them out of every "latest execution of this task" read.
 * Dependency-free on purpose: imported by many query sites.
 *
 * Why the filter exists: the jury records its spend as an AgentExecution under
 * the task's newest session, AFTER the implementer/verifier row it judged.
 * Several guards compare "the newest execution" against a receipt taken before
 * the review (requirement-replan-commit, verify-repair-commit, ...) and the
 * jury itself reads the newest row's modelName to seat the implementer last.
 * Without this filter a cost row would supersede the real run in all of them.
 */

/** `AgentExecution.command` of a review cost row. */
export const REVIEW_COST_COMMAND = 'adversarial-review';

/** Spread into an AgentExecution `where` to skip review cost rows. */
export const NOT_REVIEW_COST_ROW: { command: { not: string } } = {
  command: { not: REVIEW_COST_COMMAND },
};
