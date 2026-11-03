/**
 * changed-tests-gate tests (#1410)
 *
 * A changed test runs without registration, an excluded integration test is
 * reported rather than silently dropped, and the backend run is green only
 * when bun's own report shows every changed file ran.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectChangedTests, filesInJunit, judgeBun } = require('./changed-tests-gate.cjs');

const changed = [
  'rapitas-backend/services/x.ts',
  'rapitas-backend/services/x.test.ts',
  'rapitas-backend/tests/integration/live.test.ts',
  'rapitas-frontend/src/a/B.test.tsx',
  'rapitas-frontend/src/a/b.ts',
  'rapitas-frontend/e2e/flow.test.ts',
  'scripts/foo.test.cjs',
];

test('selects each package’s changed tests; integration tests are listed as excluded', () => {
  assert.deepEqual(selectChangedTests(changed, 'backend'), {
    run: ['services/x.test.ts'],
    excluded: ['tests/integration/live.test.ts'],
  });
  assert.deepEqual(selectChangedTests(changed, 'frontend'), {
    run: ['src/a/B.test.tsx'],
    excluded: [],
  });
});

const junit = (files) =>
  `<testsuites>${files.map((f) => `<testsuite name="${f}" file="${f}" tests="1">`).join('')}</testsuites>`;

test('junit file attributes are read with Windows separators normalised', () => {
  assert.deepEqual([...filesInJunit(junit(['services\\x.test.ts', 'tests/y.test.ts']))].sort(), [
    'services/x.test.ts',
    'tests/y.test.ts',
  ]);
});

test('green only when every changed file ran and bun exited 0', () => {
  const wanted = ['services/x.test.ts'];
  assert.deepEqual(judgeBun({ wanted, exitCode: 0, junit: junit(wanted) }), []);
  // The acceptance case: a deliberately broken new test fails the check.
  assert.match(judgeBun({ wanted, exitCode: 1, junit: junit(wanted) }).join(), /exited 1/);
  assert.match(judgeBun({ wanted, exitCode: 0, junit: junit([]) }).join(), /not run by bun/);
  assert.match(judgeBun({ wanted, exitCode: 0, junit: null }).join(), /no junit report/);
  assert.match(judgeBun({ wanted, exitCode: null, junit: null }).join(), /did not run/);
});
