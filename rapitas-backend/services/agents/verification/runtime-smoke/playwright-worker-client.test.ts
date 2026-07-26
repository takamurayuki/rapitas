/**
 * playwright-worker-client.test
 *
 * Regression coverage for the Bun/Playwright incompatibility this module
 * works around: chromium.launch() and chromium.connectOverCDP() were
 * confirmed live to hang until timeout when called directly from a Bun
 * process (both the pipe and WebSocket CDP transports), while succeeding in
 * under a second from a plain Node.js child process. These tests spawn the
 * REAL worker script against a real system browser (mirrors the level of
 * "real" testing app-launcher.ts's allocateFreePort/waitForHealthy already
 * do) — this is deliberately an integration test, not a mocked unit test,
 * because the whole point of this module is a cross-runtime IPC boundary
 * that a mock can't meaningfully exercise.
 */
import { describe, test, expect } from 'bun:test';
import { spawnPlaywrightWorker } from './playwright-worker-client';

describe('spawnPlaywrightWorker', () => {
  test('launches a real system browser, navigates, screenshots, and closes cleanly', async () => {
    const worker = spawnPlaywrightWorker();
    try {
      const { channel } = await worker.launch({
        channels: ['msedge', 'chrome'],
        timeoutMs: 20_000,
        viewport: { width: 800, height: 600 },
      });
      expect(['msedge', 'chrome']).toContain(channel);

      const nav = await worker.openAndNavigate({ url: 'https://example.com', timeoutMs: 15_000 });
      expect(nav.ok).toBe(true);

      const shot = await worker.screenshot();
      expect(shot.length).toBeGreaterThan(0);
      // PNG magic bytes.
      expect(shot.subarray(0, 4).toString('hex')).toBe('89504e47');
    } finally {
      await worker.close();
    }
  }, 30_000);

  test('relays click/type/pressKey/scroll to the live page without error', async () => {
    // Verifies the IPC bridge itself (protocol round-trip for each command) —
    // Playwright's own input-simulation correctness is out of scope here.
    // NOTE: plain `await`, not `expect(promise).resolves...` — the latter
    // reproducibly hung on these specific calls under bun:test (confirmed:
    // the identical call succeeds in under 100ms both standalone and via a
    // bare `await` in this exact file/position; only wrapping it in
    // `expect().resolves` triggered the hang, isolated down to that one
    // matcher). If a call actually rejects, `await` surfaces it as a normal
    // thrown error and fails the test — no assertion wrapper needed.
    const worker = spawnPlaywrightWorker();
    try {
      await worker.launch({ channels: ['msedge', 'chrome'], timeoutMs: 20_000 });
      const nav = await worker.openAndNavigate({ url: 'https://example.com', timeoutMs: 15_000 });
      expect(nav.ok).toBe(true);

      await worker.click({ x: 20, y: 30 });
      await worker.type({ text: 'hello' });
      await worker.pressKey({ key: 'Enter' });
      await worker.scroll({ deltaY: 500 });
    } finally {
      await worker.close();
    }
  }, 30_000);

  test('checkPath returns a finding without needing openAndNavigate first', async () => {
    const worker = spawnPlaywrightWorker();
    try {
      await worker.launch({ channels: ['msedge', 'chrome'], timeoutMs: 20_000 });
      const finding = await worker.checkPath({
        url: 'https://example.com',
        timeoutMs: 15_000,
        settleMs: 200,
      });
      expect(finding.httpStatus).toBe(200);
      expect(finding.navigationError).toBeNull();
    } finally {
      await worker.close();
    }
  }, 30_000);

  test('surfaces a clear error when the node binary cannot be found', async () => {
    const original = process.env.RAPITAS_NODE_BIN;
    process.env.RAPITAS_NODE_BIN = 'this-binary-does-not-exist-xyz';
    try {
      const worker = spawnPlaywrightWorker();
      await expect(worker.launch({ channels: ['msedge'] })).rejects.toThrow(
        /failed to start|ENOENT/i,
      );
      await worker.close(); // must not throw even though the process never started
    } finally {
      if (original === undefined) delete process.env.RAPITAS_NODE_BIN;
      else process.env.RAPITAS_NODE_BIN = original;
    }
  });

  test('close() is a safe no-op when called before anything was launched', async () => {
    const worker = spawnPlaywrightWorker();
    await expect(worker.close()).resolves.toBeUndefined();
  });
});
