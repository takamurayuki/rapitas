/**
 * workflow-cli-executor-mock-state
 *
 * Shared mutable mock state + a single `installWorkflowCliExecutorMocks()`
 * entry point for the workflow-cli-executor split test suite
 * (services/workflow/workflow-cli-executor.*.test.ts).
 *
 * executeCLIAgent has ~17 direct/dynamic module dependencies. bun's
 * `mock.module` registry is process-global, and when several test FILES each
 * register their OWN factory for the same specifier, only the last-registered
 * factory is actually consulted once test bodies run (verified empirically:
 * running two pre-existing split suites — branch-pr-ops.test.ts and
 * branch-pr-ops-merge-revert.test.ts — together makes some of the first
 * file's tests silently exercise the second file's mocks instead of its own).
 * Every workflow-cli-executor split file therefore calls the exact same
 * `installWorkflowCliExecutorMocks()`, whose factories all read from the
 * mutable fields below. Whichever file's registration ends up "active" makes
 * no difference — behavior is always driven by whichever test most recently
 * mutated this shared state. Each split file MUST call `resetWfMockState()`
 * in its own `beforeEach` so state never leaks between files.
 *
 * NOTE: This file is now a barrel. The implementation is split by
 * responsibility into the sibling -types / -fields / -spies / -install files;
 * add new code there, not here.
 */
export * from './workflow-cli-executor-mock-state-types';
export * from './workflow-cli-executor-mock-state-fields';
export * from './workflow-cli-executor-mock-state-spies';
export * from './workflow-cli-executor-mock-state-install';
