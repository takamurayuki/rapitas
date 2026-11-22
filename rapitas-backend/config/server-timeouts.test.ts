/**
 * server-timeouts tests
 *
 * Pins the relation between the server's idle timeout and the SSE keepalive.
 */
import { describe, expect, it } from 'bun:test';
import { SERVER_IDLE_TIMEOUT_S, SSE_PING_INTERVAL_MS } from './server-timeouts';

// 2026-11-22: the ping ran every 60 s against a 30 s idle timeout, so Bun
// closed every SSE stream as idle and every window reconnected once a minute;
// the reconnects and their fallback polling crowded the browser's six
// connections to :3001 and plain fetches timed out
// ("[taskCacheStore] fetchUpdates error … signal is aborted without reason").
describe('SSE keepalive vs server idle timeout', () => {
  it('pings well inside the idle timeout, so an SSE stream is never idle', () => {
    expect(SSE_PING_INTERVAL_MS * 1.5).toBeLessThanOrEqual(SERVER_IDLE_TIMEOUT_S * 1000);
  });

  it('keeps the idle timeout that releases CLOSE_WAIT sockets', () => {
    expect(SERVER_IDLE_TIMEOUT_S).toBeGreaterThan(0);
  });
});
