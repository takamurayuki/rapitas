'use strict';
/**
 * ghost-socket-recovery.test
 *
 * The incidents this encodes (2026-11-20, three times in one day): the
 * backend died, a process it had spawned kept the inherited LISTEN handle
 * on :3001, and the new backend bound beside it. Connections split between
 * the live socket and the ghost, and every screen hung.
 *
 * - The holder was a `bash.exe` (an agent's background shell) and a
 *   `node.exe` whose parent was still alive at the first sweep, so one sweep
 *   right after the stop missed it.
 * - dev.js then reported "released" without checking, and started the new
 *   backend beside the ghost.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GHOST_HOLDER_NAMES, recoverGhostSocket } = require('./ghost-socket-recovery.cjs');

const fakePort = (clearAfterSweeps) => {
  let sweeps = 0;
  return {
    get sweeps() {
      return sweeps;
    },
    deps: {
      isPortListening: () => sweeps < clearAfterSweeps,
      liveListeningPids: () => new Set(),
      sweep: () => {
        sweeps += 1;
      },
      sleep: () => {},
    },
  };
};

test('bash and cmd shells are holder candidates, not only node and bun', () => {
  for (const name of ['bash.exe', 'cmd.exe', 'node.exe', 'bun.exe']) {
    assert.ok(GHOST_HOLDER_NAMES.test(name), name);
  }
  assert.ok(!GHOST_HOLDER_NAMES.test('explorer.exe'));
});

test('sweeps again until the ghost is gone — one sweep is not enough', () => {
  const port = fakePort(3);
  const result = recoverGhostSocket(3001, port.deps);
  assert.equal(result.cleared, true);
  assert.equal(port.sweeps, 3);
});

test('reports a ghost that survives every sweep instead of calling it released', () => {
  const port = fakePort(Infinity);
  const result = recoverGhostSocket(3001, { ...port.deps, attempts: 4 });
  assert.equal(result.cleared, false);
  assert.equal(port.sweeps, 4);
});

test('a live listener is not a ghost: nothing is swept', () => {
  let swept = 0;
  const result = recoverGhostSocket(3001, {
    isPortListening: () => true,
    liveListeningPids: () => new Set([4242]),
    sweep: () => {
      swept += 1;
    },
    sleep: () => {},
  });
  assert.equal(result.cleared, false);
  assert.equal(result.liveHolders, true);
  assert.equal(swept, 0);
});

test('a free port needs no sweep', () => {
  const port = fakePort(0);
  assert.deepEqual(recoverGhostSocket(3001, port.deps), {
    cleared: true,
    sweeps: 0,
    liveHolders: false,
  });
});

// dev.js is not importable in a test (it starts the stack on load), so the
// wiring is held by its source: a refactor that drops either call reopens the
// 2026-11-20 outages.
test('dev.js sweeps through recoverGhostSocket and retries a refused start', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'dev.js'),
    'utf8',
  );
  assert.match(src, /recoverGhostSocket\(port, \{/);
  assert.match(src, /-notmatch '\$\{GHOST_HOLDER_NAMES\.source\}'/);
  const refusals = src.split('Refusing to start the backend').length - 1;
  const retries = src.split('scheduleBackendStartRetry();').length - 1;
  assert.ok(refusals >= 2 && retries >= refusals, `${refusals} refusals, ${retries} retries`);
});
