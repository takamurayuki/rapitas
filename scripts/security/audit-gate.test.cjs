/**
 * audit-gate tests (#1340)
 *
 * The gate must turn red on an uncovered high, stay green when every high has
 * a live exception, and turn red again the day an exception expires.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAudit, evaluate, renderSummary } = require('./audit-gate.cjs');

const PNPM = {
  advisories: {
    1: {
      module_name: 'zod',
      severity: 'high',
      github_advisory_id: 'GHSA-mrhx-c7xc-m3w5',
      title: 'Zod can exhaust memory',
    },
    2: {
      module_name: 'file-type',
      severity: 'moderate',
      url: 'https://github.com/advisories/GHSA-5v7r-6r5c-r473',
    },
  },
};
const BUN = {
  'deepmerge-ts': [
    {
      url: 'https://github.com/advisories/GHSA-ggr8-5vv4-36mx',
      severity: 'high',
      title: 'stack exhaustion',
    },
  ],
  glob: [
    { url: 'https://github.com/advisories/GHSA-3g3m-2fjr-6pw4', severity: 'moderate', title: 'x' },
  ],
};
const NOW = new Date('2026-11-03T00:00:00Z');
const ex = (scope, ghsa, expires = '2027-01-31') => ({
  scope,
  ghsa,
  package: 'p',
  reason: 'why',
  expires,
});

test('both audit formats are read, with the GHSA id taken from the url when needed', () => {
  const f = [...parseAudit('desktop', 'pnpm', PNPM), ...parseAudit('backend', 'bun', BUN)];
  assert.deepEqual(
    f.map((x) => `${x.scope}:${x.pkg}:${x.ghsa}:${x.severity}`),
    [
      'desktop:zod:GHSA-mrhx-c7xc-m3w5:high',
      'desktop:file-type:GHSA-5v7r-6r5c-r473:moderate',
      'backend:deepmerge-ts:GHSA-ggr8-5vv4-36mx:high',
      'backend:glob:GHSA-3g3m-2fjr-6pw4:moderate',
    ],
  );
});

test('an uncovered high blocks; moderates never do', () => {
  const v = evaluate(parseAudit('backend', 'bun', BUN), [], NOW);
  assert.deepEqual(
    v.blocking.map((x) => x.pkg),
    ['deepmerge-ts'],
  );
});

test('a live exception excuses only its own scope', () => {
  const findings = [
    ...parseAudit('desktop', 'pnpm', PNPM),
    ...parseAudit('frontend', 'pnpm', PNPM),
  ];
  const v = evaluate(findings, [ex('desktop', 'GHSA-mrhx-c7xc-m3w5')], NOW);
  assert.deepEqual(
    v.excused.map((x) => x.scope),
    ['desktop'],
  );
  assert.deepEqual(
    v.blocking.map((x) => x.scope),
    ['frontend'],
  );
});

test('an expired exception fails the gate and no longer excuses its finding', () => {
  const v = evaluate(
    parseAudit('desktop', 'pnpm', PNPM),
    [ex('desktop', 'GHSA-mrhx-c7xc-m3w5', '2026-11-02')],
    NOW,
  );
  assert.equal(v.expired.length, 1);
  assert.equal(v.blocking.length, 1);
});

test('an exception without a reason or a date is invalid', () => {
  const v = evaluate([], [{ scope: 'x', ghsa: 'GHSA-aaaa-bbbb-cccc', expires: 'soon' }], NOW);
  assert.equal(v.invalid.length, 1);
});

test('the summary never reads as clean when something blocks', () => {
  const v = evaluate(parseAudit('backend', 'bun', BUN), [], NOW);
  assert.match(renderSummary(v), /要対応/);
  assert.doesNotMatch(renderSummary(v), /通過/);
});

test('the committed exceptions file is valid and nothing in it has expired yet', () => {
  const file = require('../../.github/audit-exceptions.json');
  const v = evaluate([], file.exceptions, new Date());
  assert.deepEqual(v.invalid, []);
  assert.deepEqual(v.expired, [], 'renew or remove: an expired exception fails every PR');
});

// #1410: an audit that FAILED (network error, registry 5xx) still prints JSON.
// Read as "no advisories", it made the gate green on a blind run.
test('an error report or an unexpected shape is rejected, never read as clean', () => {
  const pnpmError = { error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'fetch failed' } };
  assert.throws(() => parseAudit('frontend', 'pnpm', pnpmError), /not an audit result/);
  assert.throws(() => parseAudit('frontend', 'pnpm', {}), /not an audit result/);
  assert.throws(() => parseAudit('frontend', 'pnpm', null), /not an audit result/);
  assert.throws(() => parseAudit('backend', 'bun', { error: 'network' }), /not an audit result/);
  assert.throws(() => parseAudit('backend', 'bun', [1, 2]), /not an audit result/);
  assert.throws(() => parseAudit('backend', 'bun', null), /not an audit result/);
});

test('a genuinely clean report is still accepted', () => {
  assert.deepEqual(parseAudit('frontend', 'pnpm', { advisories: {}, metadata: {} }), []);
  assert.deepEqual(parseAudit('backend', 'bun', {}), []);
});
