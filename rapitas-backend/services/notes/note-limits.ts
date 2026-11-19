/**
 * NoteLimits
 *
 * Size caps every note write shares, kept apart so the content rules and the
 * service can both import them without importing each other.
 */

/** Caps so one request cannot post a document the size of the backlog. */
export const MAX_NOTE_TITLE = 300;
export const MAX_NOTE_CONTENT = 200_000;
export const MAX_NOTE_TAGS = 30;
