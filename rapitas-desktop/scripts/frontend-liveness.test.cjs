'use strict';
/**
 * frontend-liveness tests
 *
 * Pins when dev.js brings a dead frontend back (#1230): on 2026-10-22 next died
 * mid-install and port 3000 stayed empty indefinitely, because every existing
 * recycle trigger watched a process that was alive.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextLiveness, initialLiveness, LIVENESS_DEFAULTS } = require('./frontend-liveness.cjs');

const cfg = { ...LIVENESS_DEFAULTS, graceMs: 1000, missLimit: 2, maxRestarts: 3, windowMs: 10_000 };
const obs = (over = {}) => ({
  now: 5000,
  startedAt: 0,
  listening: true,
  exited: false,
  busy: false,
  ...over,
});

test('a listening frontend needs nothing and clears any misses', () => {
  const r = nextLiveness({ ...initialLiveness(), misses: 1 }, obs(), cfg);
  assert.equal(r.action, 'none');
  assert.equal(r.state.misses, 0);
});

test('an exited frontend with an empty port is restarted on the first check', () => {
  const r = nextLiveness(initialLiveness(), obs({ listening: false, exited: true }), cfg);
  assert.equal(r.action, 'restart');
  assert.equal(r.reason, 'frontend-exited');
});

test('a live process whose port is empty is restarted only after missLimit checks', () => {
  let s = initialLiveness();
  let r = nextLiveness(s, obs({ listening: false }), cfg);
  assert.equal(r.action, 'none');
  s = r.state;
  r = nextLiveness(s, obs({ listening: false, now: 6000 }), cfg);
  assert.equal(r.action, 'restart');
  assert.equal(r.reason, 'frontend-not-listening');
});

test('the first compile is left alone: no action inside the grace window', () => {
  const r = nextLiveness(initialLiveness(), obs({ now: 500, listening: false }), cfg);
  assert.equal(r.action, 'none');
  assert.equal(r.state.misses, 0);
});

test('an exit during the grace window is still restarted', () => {
  const r = nextLiveness(initialLiveness(), obs({ now: 500, listening: false, exited: true }), cfg);
  assert.equal(r.action, 'restart');
});

test('nothing happens while a restart or cleanup is already in progress', () => {
  const r = nextLiveness(
    initialLiveness(),
    obs({ listening: false, exited: true, busy: true }),
    cfg,
  );
  assert.equal(r.action, 'none');
});

// #1262: another program can hold :3000. Our process exiting while the port is
// held means the port is not ours to recycle — restartFrontend would kill it.
test('an exited frontend whose port is held by something else is reported, not killed', () => {
  const r = nextLiveness(initialLiveness(), obs({ listening: true, exited: true }), cfg);
  assert.equal(r.action, 'report');
  assert.equal(r.reason, 'frontend-exited-port-held');
  const again = nextLiveness(r.state, obs({ listening: true, exited: true, now: 6000 }), cfg);
  assert.equal(again.action, 'none', 'reported once, not every tick');
});

test('restarts are capped per window, then it gives up once and says so', () => {
  let s = initialLiveness();
  const dead = (now) => obs({ listening: false, exited: true, now, startedAt: now - 5000 });
  const actions = [];
  for (const now of [5000, 6000, 7000, 8000, 9000]) {
    const r = nextLiveness(s, dead(now), cfg);
    actions.push(r.action);
    s = r.state;
  }
  assert.deepEqual(actions, ['restart', 'restart', 'restart', 'give-up', 'none']);
});

test('the cap is a sliding window: old restarts age out', () => {
  let s = initialLiveness();
  const dead = (now) => obs({ listening: false, exited: true, now, startedAt: now - 5000 });
  for (const now of [5000, 6000, 7000]) s = nextLiveness(s, dead(now), cfg).state;
  const r = nextLiveness(s, dead(5000 + cfg.windowMs + 1), cfg);
  assert.equal(r.action, 'restart');
});
