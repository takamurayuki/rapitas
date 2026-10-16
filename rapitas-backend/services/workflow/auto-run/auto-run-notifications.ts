/**
 * auto-run-notifications
 *
 * Barrel re-exporting notification records for theme auto-run lifecycle
 * events that need USER attention. Split into auto-run-notifications-shared /
 * -hold / -terminal (task 784) to stay under the file-size ratchet — import
 * paths through this barrel are unaffected. The scheduler only broadcasts
 * SSE — invisible unless the user is watching that screen — so these persist
 * to the Notification table the header bell and browser notifications read.
 */
export * from './auto-run-notifications-shared';
export * from './auto-run-notifications-hold';
export * from './auto-run-notifications-terminal';
