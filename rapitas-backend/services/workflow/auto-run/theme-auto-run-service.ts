/**
 * theme-auto-run-service
 *
 * Barrel re-exporting the CRUD + state-machine helpers for ThemeAutoRun
 * records. Split into theme-auto-run-types / -mutations / -queries (task
 * 784) to stay under the file-size ratchet — import paths through this
 * barrel are unaffected. Does NOT contain scheduling logic — see
 * theme-auto-run-scheduler.ts.
 */
export * from './theme-auto-run-types';
export * from './theme-auto-run-mutations';
export * from './theme-auto-run-queries';
