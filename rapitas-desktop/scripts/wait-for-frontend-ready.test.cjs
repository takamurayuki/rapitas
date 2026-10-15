'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitForFrontendReady, READY_STATUS_MIN, READY_STATUS_MAX } = require('./wait-for-frontend-ready.cjs');

/** A clock and sleeper that advance together, so no test actually waits. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

const quietLog = { info() {}, warn() {} };

test('resolves ready as soon as the probe answers', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 60_000,
    probe: async () => ++calls >= 3,
    ...clock,
    log: quietLog,
  });
  assert.equal(result.ready, true);
  assert.equal(calls, 3);
});

test('gives up at the timeout instead of waiting forever', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 5_000,
    pollIntervalMs: 1_000,
    probe: async () => {
      calls++;
      return false;
    },
    ...clock,
    log: quietLog,
  });
  assert.equal(result.ready, false);
  // Bounded: roughly timeout / pollInterval, never unbounded.
  assert.ok(calls <= 7, `probe called ${calls} times`);
});

// A probe that throws (ECONNREFUSED while Next has not opened the port yet) is
// "not ready", never an error that aborts the startup.
test('a throwing probe counts as not ready and does not reject', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 3_000,
    pollIntervalMs: 1_000,
    probe: async () => {
      if (++calls < 2) throw new Error('ECONNREFUSED');
      return true;
    },
    ...clock,
    log: quietLog,
  });
  assert.equal(result.ready, true);
});

test('reports progress periodically while waiting, not on every poll', async () => {
  const clock = fakeClock();
  const lines = [];
  let calls = 0;
  await waitForFrontendReady({
    port: 3000,
    timeoutMs: 30_000,
    pollIntervalMs: 1_000,
    progressEveryMs: 10_000,
    probe: async () => ++calls >= 25,
    ...clock,
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
  });
  const progress = lines.filter((l) => /待機中|waiting/i.test(l));
  assert.ok(progress.length >= 2, `progress lines: ${progress.length}`);
  assert.ok(progress.length <= 4, `too chatty: ${progress.length}`);
});

test('elapsedMs reflects the wait', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 60_000,
    pollIntervalMs: 1_000,
    probe: async () => ++calls >= 5,
    ...clock,
    log: quietLog,
  });
  assert.ok(result.elapsedMs >= 4_000, `elapsedMs=${result.elapsedMs}`);
});

// Next.js answers 404 for an unknown route while being perfectly up, so the
// readiness band must not be 200-only; a 5xx is the dev server failing to
// compile and must NOT count as ready.
test('the ready status band accepts 2xx-4xx and rejects 5xx', () => {
  assert.equal(READY_STATUS_MIN, 200);
  assert.equal(READY_STATUS_MAX, 499);
});

test('a zero/negative timeout still probes once (no silent skip)', async () => {
  const clock = fakeClock();
  let calls = 0;
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 0,
    probe: async () => {
      calls++;
      return true;
    },
    ...clock,
    log: quietLog,
  });
  assert.equal(calls, 1);
  assert.equal(result.ready, true);
});
