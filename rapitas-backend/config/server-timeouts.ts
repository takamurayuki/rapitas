/**
 * server-timeouts
 *
 * The HTTP server's idle timeout and the SSE keepalive that must stay inside it.
 */

/** Bun server idle timeout in seconds; closes sockets left in CLOSE_WAIT. */
export const SERVER_IDLE_TIMEOUT_S = 30;

/**
 * SSE ping interval. It must stay well inside the idle timeout: a stream that
 * writes nothing for SERVER_IDLE_TIMEOUT_S is closed by Bun as idle.
 *
 * NOTE: This was 60 s against the 30 s idle timeout, so every SSE stream was
 * closed once a minute and every window reconnected. With four app windows the
 * reconnects and their fallback polling crowded the browser's six connections
 * to :3001, and plain fetches timed out (2026-11-22).
 */
export const SSE_PING_INTERVAL_MS = 15_000;
