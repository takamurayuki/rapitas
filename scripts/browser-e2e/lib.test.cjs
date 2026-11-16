/**
 * browser-e2e/lib.test
 *
 * Unit tests for the Browser E2E runner's pure helpers — above all the
 * verdict, which must never call a run green when nothing ran.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('./lib.cjs');

const passed = (name, assertions = 3) => ({ name, status: 'passed', assertions, ms: 10 });
const base = { expected: ['a', 'b'], browserLaunched: true, reservedHits: [] };

test('evaluateRun: all expected scenarios passed with assertions is green', () => {
  const v = lib.evaluateRun({ ...base, results: [passed('a'), passed('b')] });
  assert.deepEqual(v, { ok: true, problems: [] });
});

test('evaluateRun: a scenario that never ran is red', () => {
  const v = lib.evaluateRun({ ...base, results: [passed('a')] });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(), /b: did not run/);
});

test('evaluateRun: no results at all is red, not vacuously green', () => {
  assert.equal(lib.evaluateRun({ ...base, results: [] }).ok, false);
});

test('evaluateRun: an empty scenario list is red', () => {
  const v = lib.evaluateRun({ ...base, expected: [], results: [] });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(), /no scenarios/);
});

test('evaluateRun: passing with zero assertions is red', () => {
  const v = lib.evaluateRun({ ...base, results: [passed('a'), passed('b', 0)] });
  assert.equal(v.ok, false);
  assert.match(v.problems.join(), /without asserting/);
});

test('evaluateRun: a browser that never launched is red', () => {
  const v = lib.evaluateRun({
    ...base,
    browserLaunched: false,
    results: [passed('a'), passed('b')],
  });
  assert.equal(v.ok, false);
});

test('evaluateRun: a failed or skipped scenario is red', () => {
  for (const status of ['failed', 'skipped']) {
    const v = lib.evaluateRun({
      ...base,
      results: [passed('a'), { ...passed('b'), status }],
    });
    assert.equal(v.ok, false, status);
  }
});

test('evaluateRun: any request to a reserved port is red', () => {
  const v = lib.evaluateRun({
    ...base,
    results: [passed('a'), passed('b')],
    reservedHits: ['http://127.0.0.1:3001/tasks'],
  });
  assert.equal(v.ok, false);
});

test('assertSafePorts refuses the live dev ports, bad values and equal ports', () => {
  assert.doesNotThrow(() => lib.assertSafePorts({ backendPort: 3221, frontendPort: 3220 }));
  assert.throws(() => lib.assertSafePorts({ backendPort: 3001, frontendPort: 3220 }), /live dev/);
  assert.throws(() => lib.assertSafePorts({ backendPort: 3221, frontendPort: 3000 }), /live dev/);
  assert.throws(() => lib.assertSafePorts({ backendPort: NaN, frontendPort: 3220 }));
  assert.throws(() => lib.assertSafePorts({ backendPort: 80, frontendPort: 3220 }));
  assert.throws(() => lib.assertSafePorts({ backendPort: 3221, frontendPort: 3221 }), /differ/);
});

test('parsePort rejects what parseInt would silently truncate', () => {
  assert.equal(lib.parsePort(undefined, 3221), 3221);
  assert.equal(lib.parsePort('', 3221), 3221);
  assert.equal(lib.parsePort('4000', 3221), 4000);
  assert.ok(Number.isNaN(lib.parsePort('32a1', 3221)));
  assert.ok(Number.isNaN(lib.parsePort('3e3', 3221)));
});

test('parseSabotage accepts known ids only', () => {
  assert.equal(lib.parseSabotage(undefined), null);
  assert.equal(lib.parseSabotage('hide-alerts'), 'hide-alerts');
  assert.throws(() => lib.parseSabotage('hide-alert'), /unknown/);
});

test('commonAncestor finds the deepest shared directory', () => {
  const path = require('node:path');
  const r = path.resolve('/x/repo');
  assert.equal(lib.commonAncestor(path.join(r, 'wt', 'a'), path.join(r, 'fe', 'nm'), false), r);
  assert.equal(lib.commonAncestor(path.join(r, 'A'), path.join(r, 'a'), true), path.join(r, 'A'));
});

test('createChecker counts passes and throws with the label on failure', () => {
  const c = lib.createChecker();
  c.check('one', true);
  c.check('two', true);
  assert.equal(c.count(), 2);
  assert.throws(() => c.check('three', false, 'got x'), /three — got x/);
  assert.equal(c.count(), 2);
});

test('renderSummary shows the verdict, rows and problems, escaping pipes', () => {
  const md = lib.renderSummary({
    results: [{ name: 'a', status: 'failed', assertions: 1, ms: 1500, error: 'x | y' }],
    verdict: { ok: false, problems: ['a: failed'] },
    meta: { duration: '3s' },
  });
  assert.match(md, /Browser E2E — FAIL/);
  assert.match(md, /\| a \| failed \| 1 \| 1\.5s \| x \\\| y \|/);
  assert.match(md, /### Problems/);
});

test('pollUntil resolves on success and gives up at the deadline', async () => {
  let t = 0;
  const clock = { now: () => t, sleep: async (ms) => void (t += ms) };
  let n = 0;
  const ok = await lib.pollUntil(async () => ++n === 3, { timeoutMs: 10_000, ...clock });
  assert.equal(ok.ok, true);
  assert.equal(n, 3);
  t = 0;
  const no = await lib.pollUntil(
    async () => {
      throw new Error('down');
    },
    { timeoutMs: 2000, intervalMs: 500, ...clock },
  );
  assert.equal(no.ok, false);
  assert.ok(no.elapsedMs >= 2000);
});

test('createTailBuffer keeps only the tail', () => {
  const b = lib.createTailBuffer(5);
  b.append('abc');
  b.append('defg');
  assert.equal(b.read(), 'cdefg');
});
