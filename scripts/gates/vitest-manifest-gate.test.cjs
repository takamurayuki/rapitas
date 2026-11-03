/**
 * vitest-manifest-gate tests (#1410)
 *
 * Green only when every listed file exists, ran, the report is readable and
 * vitest exited 0 — the case that slipped through was two moved files that
 * vitest silently skipped while the job stayed green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseManifest, judge } = require('./vitest-manifest-gate.cjs');

const cwd = path.resolve('/repo/rapitas-frontend');
const abs = (f) => path.join(cwd, f);
const report = (files, numTotalTests = files.length) => ({
  numTotalTests,
  testResults: files.map((f) => ({ name: abs(f) })),
});

test('comments and blank lines are not paths', () => {
  assert.deepEqual(parseManifest('# header\n\nsrc/a.test.ts  # note\nsrc/b.test.tsx\n'), [
    'src/a.test.ts',
    'src/b.test.tsx',
  ]);
});

test('passes when every listed file exists, ran, and vitest exited 0', () => {
  const listed = ['src/a.test.ts', 'src/b.test.tsx'];
  assert.deepEqual(
    judge({ listed, exists: () => true, exitCode: 0, report: report(listed), cwd }),
    [],
  );
});

test('the #1376 case: a moved file fails even though vitest exited 0', () => {
  const listed = ['src/a.test.ts', 'src/old/moved.test.tsx'];
  const problems = judge({
    listed,
    exists: (f) => f !== 'src/old/moved.test.tsx',
    exitCode: 0,
    report: report(['src/a.test.ts']),
    cwd,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not exist.*moved\.test\.tsx/);
});

test('a listed file vitest did not run fails', () => {
  const listed = ['src/a.test.ts', 'src/b.test.ts'];
  const problems = judge({
    listed,
    exists: () => true,
    exitCode: 0,
    report: report(['src/a.test.ts']),
    cwd,
  });
  assert.match(problems.join('\n'), /not run by vitest: src\/b\.test\.ts/);
});

test('no report, a spawn failure, a non-zero exit, or zero tests is never success', () => {
  const listed = ['src/a.test.ts'];
  const base = { listed, exists: () => true, cwd };
  assert.ok(judge({ ...base, exitCode: 0, report: undefined }).length);
  assert.ok(judge({ ...base, exitCode: 0, report: { error: 'boom' } }).length);
  assert.ok(judge({ ...base, exitCode: null, report: report(listed) }).length);
  assert.ok(judge({ ...base, exitCode: 1, report: report(listed) }).length);
  assert.ok(judge({ ...base, exitCode: 0, report: report(listed, 0) }).length);
});

test('an empty manifest fails', () => {
  assert.ok(judge({ listed: [], exists: () => true, exitCode: 0, report: report([]), cwd }).length);
});
