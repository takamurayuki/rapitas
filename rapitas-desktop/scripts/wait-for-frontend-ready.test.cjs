'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  waitForFrontendReady,
  classifyResponse,
  READY_STATUS_MIN,
  READY_STATUS_MAX,
} = require('./wait-for-frontend-ready.cjs');

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

/**
 * Whose server answered.
 *
 * Reported 2026-10-29: another project's Rails dev server held
 * 127.0.0.1:3000 and answered 200 on `/`. This gate passed on that 200 and
 * printed "Frontend is serving", so the rapitas window showed the other
 * project with nothing anywhere saying what had happened. A readiness check
 * that cannot tell whose server it reached is not measuring readiness.
 */
test('the app itself is ready — its own page, by the marker in it', () => {
  assert.equal(
    classifyResponse({
      statusCode: 200,
      headers: { 'x-powered-by': 'Next.js' },
      body: '<title>Rapi+</title>',
    }),
    'ready',
  );
});

test('our dev server is ready even when the body is an error overlay', () => {
  // A compile error still means OUR server is the one on the port; refusing
  // it here would turn a build error into a bogus "foreign server" report.
  assert.equal(
    classifyResponse({
      statusCode: 200,
      headers: { 'x-powered-by': 'Next.js' },
      body: '<h1>Failed to compile</h1>',
    }),
    'ready',
  );
});

test("another project's server is foreign, however healthy it looks", () => {
  assert.equal(
    classifyResponse({
      statusCode: 200,
      headers: { server: 'Puma 6.4.0' },
      body: '<title>Readify</title>',
    }),
    'foreign',
  );
});

test('a header-less 200 with our marker is still ours', () => {
  assert.equal(
    classifyResponse({ statusCode: 200, headers: {}, body: 'Rapi+' }),
    'ready',
  );
});

test('a 5xx is not serving — neither ready nor foreign', () => {
  // 5xx is our own dev server failing to compile; it must keep waiting.
  assert.equal(
    classifyResponse({
      statusCode: 500,
      headers: { 'x-powered-by': 'Next.js' },
      body: '',
    }),
    'not-serving',
  );
});

test('the header match is case-insensitive and tolerates a version suffix', () => {
  assert.equal(
    classifyResponse({ statusCode: 404, headers: { 'X-Powered-By': 'next.js' }, body: '' }),
    'ready',
  );
});

test('a foreign server stops the wait at once instead of polling for minutes', async () => {
  const clock = fakeClock();
  const lines = [];
  let calls = 0;
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 240_000,
    pollIntervalMs: 1_000,
    probe: async () => {
      calls++;
      return { kind: 'foreign', statusCode: 200, server: 'Puma 6.4.0' };
    },
    ...clock,
    log: { info: (m) => lines.push(m), warn: (m) => lines.push(m) },
  });
  assert.equal(result.ready, false);
  // Waiting four minutes for a server that will never be ours is the bug.
  assert.equal(calls, 1);
  assert.equal(result.foreign?.server, 'Puma 6.4.0');
  const text = lines.join('\n');
  assert.match(text, /3000/);
  assert.match(text, /Puma/);
});

test('a boolean probe still works, so the existing callers are unaffected', async () => {
  const clock = fakeClock();
  const result = await waitForFrontendReady({
    port: 3000,
    timeoutMs: 10_000,
    probe: async () => true,
    ...clock,
    log: quietLog,
  });
  assert.equal(result.ready, true);
});
