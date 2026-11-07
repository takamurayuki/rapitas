/**
 * process-lifecycle
 *
 * How the backend process starts and ends, as seen by its supervisor.
 */
export { runServerEntry, exitCodeForShutdown } from './exit-policy';
export type { EntryExitDeps } from './exit-policy';
