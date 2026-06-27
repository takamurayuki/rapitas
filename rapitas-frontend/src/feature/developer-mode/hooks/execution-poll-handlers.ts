/**
 * executionPollHandlers
 *
 * Public entry point for the execution polling loop. Re-exports the status
 * handlers and poll-loop body that were split into domain-grouped sibling
 * modules (shared / completion / terminal / loop). Kept as the stable import
 * path so existing callers and tests do not change.
 */

export type { PollRefs } from './execution-poll-shared';
export { handleCompleted, shouldKeepPollingAfterCompleted } from './execution-poll-completion';
export { handleFailed, handleCancelled, handleInterrupted } from './execution-poll-terminal';
export { executePoll } from './execution-poll-loop';
