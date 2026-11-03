/**
 * quality-gates.test
 *
 * node:test coverage for the quality-gates check: the YAML reader, matrix
 * name expansion, every rejection rule, the protection payload, and the real
 * tree (which must pass, with exactly the branch-protected names as required).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseYaml } = require('./workflow-yaml.cjs');
const { expandMatrix, reportedNames, checkGates, protectionPayload } = require('./gates-model.cjs');
const { run } = require('./quality-gates.cjs');

const TODAY = '2026-11-03';
const PR_WORKFLOW = `
name: CI
on:
  pull_request:
    branches: [main, develop]
jobs:
  lint:
    name: Lint Code
    runs-on: ubuntu-latest
  build:
    name: Build (\${{ matrix.platform }})
    strategy:
      matrix:
        include:
          - platform: 'ubuntu-latest'
            target: x86
          - platform: 'macos-latest'
            target: arm
          - platform: macos-latest
            target: x86
    runs-on: \${{ matrix.platform }}
`;

function gatesWith(...checks) {
  return { protectedBranches: ['main', 'develop'], alwaysClassify: [], checks };
}
const entry = (name, job, mode = 'required', extra = {}) => ({
  name,
  workflow: 'ci.yml',
  job,
  mode,
  reason: 'test',
  ...extra,
});
const ALL_CI = [
  entry('Lint Code', 'lint'),
  entry('Build (ubuntu-latest)', 'build'),
  entry('Build (macos-latest)', 'build'),
];

test('parseYaml reads mappings, sequences, flow lists, block scalars and comments', () => {
  const doc = parseYaml(`
a: 1 # trailing comment
list:
  - "x"
  - 'y # not a comment'
flow: [one, 'two', "three"]
run: |
  echo hi
  echo there
next: value
`);
  assert.deepEqual(doc, {
    a: '1',
    list: ['x', 'y # not a comment'],
    flow: ['one', 'two', 'three'],
    run: 'echo hi\necho there',
    next: 'value',
  });
});

test('parseYaml rejects anchors instead of misreading them', () => {
  assert.throws(() => parseYaml('a: &anchor\n  b: 1\n'), /anchors/);
});

test('matrix: name expressions expand per combination and duplicates collapse', () => {
  const wf = parseYaml(PR_WORKFLOW);
  assert.deepEqual(reportedNames('build', wf.jobs.build), [
    'Build (ubuntu-latest)',
    'Build (macos-latest)',
  ]);
});

test('matrix: a name without a matrix expression gets the values appended', () => {
  const job = {
    name: 'CodeQL Analysis',
    strategy: { matrix: { language: ['javascript', 'typescript'] } },
  };
  assert.deepEqual(reportedNames('codeql', job), [
    'CodeQL Analysis (javascript)',
    'CodeQL Analysis (typescript)',
  ]);
});

test('matrix: exclude removes and a non-matching include adds a combination', () => {
  const combos = expandMatrix({
    os: ['linux', 'win'],
    node: ['20', '22'],
    exclude: [{ os: 'win', node: '20' }],
    include: [
      { os: 'linux', experimental: 'yes' },
      { os: 'mac', node: '22' },
    ],
  });
  assert.deepEqual(combos, [
    { os: 'linux', node: '20', experimental: 'yes' },
    { os: 'linux', node: '22', experimental: 'yes' },
    { os: 'win', node: '22' },
    { os: 'mac', node: '22' },
  ]);
});

test('a job without a name reports its key', () => {
  assert.deepEqual(reportedNames('build-it', { 'runs-on': 'x' }), ['build-it']);
});

test('the fixture passes when every job is classified', () => {
  const { errors } = checkGates(
    gatesWith(...ALL_CI),
    { 'ci.yml': parseYaml(PR_WORKFLOW) },
    { today: TODAY },
  );
  assert.deepEqual(errors, []);
});

test('phantom name: an entry no job reports fails', () => {
  const gates = gatesWith(...ALL_CI, entry('Build (windows-latest)', 'build'));
  const { errors } = checkGates(gates, { 'ci.yml': parseYaml(PR_WORKFLOW) }, { today: TODAY });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /"Build \(windows-latest\)".*not this name/);
});

test('phantom job key fails and says where the name is really reported', () => {
  const gates = gatesWith(entry('Lint Code', 'lint-old'), ...ALL_CI.slice(1));
  const { errors } = checkGates(gates, { 'ci.yml': parseYaml(PR_WORKFLOW) }, { today: TODAY });
  assert.match(errors[0], /no job "lint-old".*reported by ci\.yml#lint/);
});

test('a required entry in a path-filtered workflow is rejected', () => {
  const wf = parseYaml(
    PR_WORKFLOW.replace(
      'branches: [main, develop]',
      "branches: [main, develop]\n    paths: ['src/**']",
    ),
  );
  const { errors } = checkGates(gatesWith(...ALL_CI), { 'ci.yml': wf }, { today: TODAY });
  assert.ok(
    errors.some((e) => /"Lint Code" \(required\).*"paths" filter/.test(e)),
    errors.join('\n'),
  );
});

test('the same path-filtered job is accepted as conditional', () => {
  const wf = parseYaml(
    PR_WORKFLOW.replace(
      'branches: [main, develop]',
      "branches: [main, develop]\n    paths: ['src/**']",
    ),
  );
  const gates = gatesWith(...ALL_CI.map((c) => ({ ...c, mode: 'conditional' })));
  assert.deepEqual(checkGates(gates, { 'ci.yml': wf }, { today: TODAY }).errors, []);
});

test('a required entry whose job is continue-on-error is rejected', () => {
  const wf = parseYaml(
    PR_WORKFLOW.replace(
      '    runs-on: ubuntu-latest',
      '    runs-on: ubuntu-latest\n    continue-on-error: true',
    ),
  );
  const { errors } = checkGates(gatesWith(...ALL_CI), { 'ci.yml': wf }, { today: TODAY });
  assert.deepEqual(errors, [
    '"Lint Code" (required): job "lint" is continue-on-error — it cannot block',
  ]);
});

test('a required entry whose job has a job-level if: is rejected', () => {
  const wf = parseYaml(
    PR_WORKFLOW.replace(
      '    runs-on: ubuntu-latest',
      "    runs-on: ubuntu-latest\n    if: github.ref == 'refs/heads/main'",
    ),
  );
  const { errors } = checkGates(gatesWith(...ALL_CI), { 'ci.yml': wf }, { today: TODAY });
  assert.match(errors[0], /job-level if:/);
});

test('a required entry on a workflow whose branches miss develop is rejected', () => {
  const wf = parseYaml(PR_WORKFLOW.replace('branches: [main, develop]', 'branches: [main]'));
  const { errors } = checkGates(gatesWith(...ALL_CI), { 'ci.yml': wf }, { today: TODAY });
  assert.ok(errors.every((e) => /does not include "develop"/.test(e)) && errors.length === 3);
});

test('an unclassified job in a PR workflow fails', () => {
  const gates = gatesWith(ALL_CI[0], ALL_CI[1]);
  const { errors } = checkGates(gates, { 'ci.yml': parseYaml(PR_WORKFLOW) }, { today: TODAY });
  assert.deepEqual(errors, [
    'unclassified job: "Build (macos-latest)" (ci.yml#build) — add it to .github/quality-gates.json as required, conditional or advisory',
  ]);
});

test('an advisory entry past its expires date fails; today and later pass', () => {
  const run = (expires) =>
    checkGates(
      gatesWith(entry('Lint Code', 'lint', 'advisory', { expires }), ...ALL_CI.slice(1)),
      { 'ci.yml': parseYaml(PR_WORKFLOW) },
      { today: TODAY },
    ).errors;
  assert.match(run('2026-11-02')[0], /expired on 2026-11-02/);
  assert.deepEqual(run(TODAY), []);
  assert.deepEqual(run('2027-01-01'), []);
});

test('schema: bad mode, duplicate name and expires on a non-advisory entry fail', () => {
  const gates = gatesWith(
    entry('Lint Code', 'lint', 'blocking'),
    entry('Lint Code', 'lint', 'required', { expires: '2027-01-01' }),
  );
  const { errors } = checkGates(gates, {}, { today: TODAY });
  assert.ok(errors.some((e) => /"mode" must be/.test(e)));
  assert.ok(errors.some((e) => /duplicate name/.test(e)));
  assert.ok(errors.some((e) => /"expires" is only meaningful on advisory/.test(e)));
});

test('protection payload lists exactly the required entries', () => {
  const gates = gatesWith(
    entry('A', 'a'),
    entry('B', 'b', 'conditional'),
    entry('C', 'c', 'advisory'),
    entry('D', 'd'),
  );
  assert.deepEqual(protectionPayload(gates, { strict: false, enforceAdmins: true }), {
    required_status_checks: { strict: false, contexts: ['A', 'D'] },
    enforce_admins: true,
    required_pull_request_reviews: null,
    restrictions: null,
  });
});

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REAL_GATES = path.join(REPO_ROOT, '.github', 'quality-gates.json');

test('real tree: the committed gates file passes --check', () => {
  assert.equal(run(['--check', '--today', TODAY]), 0);
});

test('real tree: required entries are exactly the 15 contexts branch protection requires', () => {
  const gates = JSON.parse(fs.readFileSync(REAL_GATES, 'utf8'));
  const required = gates.checks
    .filter((c) => c.mode === 'required')
    .map((c) => c.name)
    .sort();
  assert.deepEqual(required, [
    'Build (macos-latest)',
    'Build (ubuntu-latest)',
    'Build (windows-latest)',
    'Check Frontend',
    'Check Rust Code',
    'Check Rust Code (Windows)',
    'CodeQL Analysis (javascript)',
    'CodeQL Analysis (typescript)',
    'Dependency Security Check',
    'Lint Code',
    'NPM Security Audit',
    'Rust Security Audit',
    'Secret scanning',
    'Test Backend',
    'Test SQLite Compatible Suite',
  ]);
});

test('real tree: a misspelled required name in a scratch copy turns --check red', () => {
  const gates = JSON.parse(fs.readFileSync(REAL_GATES, 'utf8'));
  gates.checks.find((c) => c.name === 'Test Backend').name = 'Test Backnd';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gates-'));
  const scratch = path.join(dir, 'quality-gates.json');
  fs.writeFileSync(scratch, JSON.stringify(gates));
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    assert.equal(run(['--check', '--gates', scratch, '--today', TODAY]), 1);
  } finally {
    console.error = original;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const text = errors.join('\n');
  assert.match(text, /"Test Backnd" \(required\)/);
  assert.match(text, /unclassified job: "Test Backend"/);
});
