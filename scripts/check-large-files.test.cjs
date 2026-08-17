/**
 * check-large-files.test.cjs
 *
 * Pins the ratchet gate semantics of check-large-files.cjs (task 600):
 * only GREW (baseline file above its snapshot) and NEW (hard violation absent
 * from the baseline) fail the gate; baseline files at/below their snapshot
 * pass. Uses node:test so it runs on the same Node the CI workflow already
 * sets up (no extra dependencies).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { computeGateOutcome } = require('./check-large-files.cjs');

const SCRIPT = path.join(__dirname, 'check-large-files.cjs');

// ─── computeGateOutcome (pure) ────────────────────────────────────────────

test('baseline file at its snapshot line count → neither GREW nor NEW', () => {
  const findings = [{ file: 'rapitas-backend/services/a.ts', lines: 600, severity: 'error' }];
  const baseline = { files: { 'rapitas-backend/services/a.ts': { lineCount: 600 } } };
  const { grew, newViolations } = computeGateOutcome(findings, baseline);
  assert.deepEqual(grew, []);
  assert.deepEqual(newViolations, []);
});

test('baseline file above its snapshot → GREW', () => {
  const findings = [{ file: 'rapitas-backend/services/a.ts', lines: 650, severity: 'error' }];
  const baseline = { files: { 'rapitas-backend/services/a.ts': { lineCount: 600 } } };
  const { grew, newViolations } = computeGateOutcome(findings, baseline);
  assert.deepEqual(grew, [
    { file: 'rapitas-backend/services/a.ts', lines: 650, baseline: 600 },
  ]);
  assert.deepEqual(newViolations, []);
});

test('hard violation absent from the baseline → NEW', () => {
  const findings = [
    { file: 'rapitas-backend/services/a.ts', lines: 600, severity: 'error' },
    { file: 'rapitas-backend/services/b.ts', lines: 510, severity: 'error' },
  ];
  const baseline = { files: { 'rapitas-backend/services/a.ts': { lineCount: 600 } } };
  const { grew, newViolations } = computeGateOutcome(findings, baseline);
  assert.deepEqual(grew, []);
  assert.deepEqual(newViolations, [{ file: 'rapitas-backend/services/b.ts', lines: 510 }]);
});

test('no baseline (strict mode is handled elsewhere) → both lists empty', () => {
  const findings = [{ file: 'rapitas-backend/services/a.ts', lines: 600, severity: 'error' }];
  const { grew, newViolations } = computeGateOutcome(findings, null);
  assert.deepEqual(grew, []);
  assert.deepEqual(newViolations, []);
});

test('soft (warn) findings never fail the gate', () => {
  const findings = [{ file: 'rapitas-backend/services/a.ts', lines: 400, severity: 'warn' }];
  const baseline = { files: {} };
  const { grew, newViolations } = computeGateOutcome(findings, baseline);
  assert.deepEqual(grew, []);
  assert.deepEqual(newViolations, []);
});

// ─── Integration: run the script against a fixture repo ───────────────────

/**
 * Creates a minimal fixture repo the script's walker recognizes:
 * <root>/rapitas-backend/services/big-file.ts plus a ratchet baseline.
 *
 * @param {number} fileLines - Line count of the fixture file. / fixtureの行数
 * @param {number} baselineLines - Snapshot recorded in the baseline. / baseline記載行数
 * @returns {string} Fixture repo root. / fixtureリポジトリのルート
 */
function makeFixtureRepo(fileLines, baselineLines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clf-fixture-'));
  const svcDir = path.join(root, 'rapitas-backend', 'services');
  fs.mkdirSync(svcDir, { recursive: true });
  fs.writeFileSync(path.join(svcDir, 'big-file.ts'), 'const x = 1;\n'.repeat(fileLines));
  fs.mkdirSync(path.join(root, '.baselines'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.baselines', 'file-size.json'),
    JSON.stringify({
      hard_limit: 500,
      soft_limit: 300,
      files: { 'rapitas-backend/services/big-file.ts': { lineCount: baselineLines } },
    }),
  );
  return root;
}

function runScript(fixtureRoot) {
  return execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, CHECK_LARGE_FILES_ROOT: fixtureRoot },
    encoding: 'utf8',
  });
}

test('exit 0: baseline file has not grown beyond its snapshot', () => {
  const root = makeFixtureRepo(600, 600);
  try {
    const out = runScript(root); // throws on non-zero exit
    assert.match(out, /ratchet/);
    assert.match(out, /\(baseline\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1: baseline file grew beyond its snapshot (GREW)', () => {
  const root = makeFixtureRepo(650, 600);
  try {
    assert.throws(
      () => runScript(root),
      (err) => {
        assert.equal(err.status, 1);
        assert.match(String(err.stderr), /grew beyond their snapshot/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('exit 1: hard violation not present in the baseline (NEW)', () => {
  const root = makeFixtureRepo(600, 600);
  const extra = path.join(root, 'rapitas-backend', 'services', 'new-offender.ts');
  fs.writeFileSync(extra, 'const y = 2;\n'.repeat(510));
  try {
    assert.throws(
      () => runScript(root),
      (err) => {
        assert.equal(err.status, 1);
        assert.match(String(err.stderr), /NEW file\(s\) exceed the hard limit/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
