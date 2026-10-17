'use strict';
/**
 * tauri-rebuild.test
 *
 * The decision matters more than the build: rebuilding on every start would
 * burn minutes of CPU for nothing, and skipping when Rust actually changed
 * leaves the desktop app running code that is no longer in the repo — the
 * exact failure this module exists to remove.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  maybeRebuildTauri,
  readLastBuiltCommit,
  BUILT,
  BUILD_FAILED,
  SKIPPED_UP_TO_DATE,
  SKIPPED_NO_RUST_CHANGES,
  SKIPPED_NO_HEAD,
  SKIPPED_DISABLED,
} = require('./tauri-rebuild.cjs');

const quietLog = { info() {}, warn() {} };
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);

/** A fresh state-file path in a temp dir, plus a helper to seed it. */
function tempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tauri-rebuild-'));
  const file = path.join(dir, 'state.json');
  return {
    file,
    seed: (commit) => fs.writeFileSync(file, JSON.stringify({ commit })),
  };
}

/**
 * A runner that answers git from a script and records every call.
 *
 * @param script - { head, diff, build } partial results / 応答の指定
 */
function fakeRun(script = {}) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'git' && args[0] === 'rev-parse') {
      return script.head ?? { code: 0, stdout: `${HEAD}\n`, stderr: '' };
    }
    if (command === 'git' && args[0] === 'diff') {
      return script.diff ?? { code: 0, stdout: '', stderr: '' };
    }
    if (command === 'cargo') {
      return script.build ?? { code: 0, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected command: ${command}`);
  };
  return { run, calls };
}

const didBuild = (calls) => calls.some((c) => c.startsWith('cargo build'));

test('builds and records when there is no previous record', async () => {
  const state = tempState();
  const { run, calls } = fakeRun();

  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    stateFile: state.file,
    run,
    log: quietLog,
  });

  assert.equal(result.action, BUILT);
  assert.ok(didBuild(calls));
  assert.equal(readLastBuiltCommit(state.file), HEAD);
});

test('does nothing when the recorded commit is already HEAD', async () => {
  const state = tempState();
  state.seed(HEAD);
  const { run, calls } = fakeRun();

  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    stateFile: state.file,
    run,
    log: quietLog,
  });

  assert.equal(result.action, SKIPPED_UP_TO_DATE);
  assert.equal(didBuild(calls), false);
});

test('skips the build when the new commits touched no Rust', async () => {
  const state = tempState();
  state.seed(OLD);
  const { run, calls } = fakeRun({ diff: { code: 0, stdout: '', stderr: '' } });

  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    stateFile: state.file,
    run,
    log: quietLog,
  });

  assert.equal(result.action, SKIPPED_NO_RUST_CHANGES);
  assert.equal(didBuild(calls), false);
  // Recorded anyway, so the same diff is not recomputed on every restart.
  assert.equal(readLastBuiltCommit(state.file), HEAD);
});

test('builds when the new commits touched src-tauri', async () => {
  const state = tempState();
  state.seed(OLD);
  const { run, calls } = fakeRun({
    diff: { code: 0, stdout: 'rapitas-desktop/src-tauri/src/link_webview.rs\n', stderr: '' },
  });

  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    stateFile: state.file,
    run,
    log: quietLog,
  });

  assert.equal(result.action, BUILT);
  assert.ok(didBuild(calls));
});

test('scopes the diff to the Rust paths', async () => {
  const state = tempState();
  state.seed(OLD);
  const { run, calls } = fakeRun();

  await maybeRebuildTauri({ repoRoot: '/repo', stateFile: state.file, run, log: quietLog });

  const diff = calls.find((c) => c.startsWith('git diff'));
  assert.ok(diff.includes('rapitas-desktop/src-tauri'), diff);
  assert.ok(diff.includes(`${OLD}..${HEAD}`), diff);
});

// A recorded commit can be unreachable — a rebased branch, a pruned object.
// Reading that as "nothing changed" would strand the shell permanently.
test('rebuilds rather than trusting a diff that failed', async () => {
  const state = tempState();
  state.seed(OLD);
  const { run, calls } = fakeRun({
    diff: { code: 128, stdout: '', stderr: 'bad revision' },
  });

  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    stateFile: state.file,
    run,
    log: quietLog,
  });

  assert.equal(result.action, BUILT);
  assert.ok(didBuild(calls));
});

// Recording a failed build would leave the stale shell in place for ever,
// because the next start would see the commit as already built.
test('does not record a failed build, so it retries', async () => {
  const state = tempState();
  const { run } = fakeRun({ build: { code: 101, stdout: '', stderr: 'error[E0432]' } });

  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    stateFile: state.file,
    run,
    log: quietLog,
  });

  assert.equal(result.action, BUILD_FAILED);
  assert.equal(readLastBuiltCommit(state.file), null);
});

test('skips entirely when disabled', async () => {
  const { run, calls } = fakeRun();
  const result = await maybeRebuildTauri({
    repoRoot: '/repo',
    run,
    log: quietLog,
    enabled: false,
  });
  assert.equal(result.action, SKIPPED_DISABLED);
  assert.equal(calls.length, 0);
});

test('skips when HEAD cannot be read', async () => {
  const { run, calls } = fakeRun({ head: { code: 128, stdout: '', stderr: 'not a repository' } });
  const result = await maybeRebuildTauri({ repoRoot: '/repo', run, log: quietLog });
  assert.equal(result.action, SKIPPED_NO_HEAD);
  assert.equal(didBuild(calls), false);
});

test('treats a corrupt state file as no record', () => {
  const state = tempState();
  fs.writeFileSync(state.file, '{ not json');
  assert.equal(readLastBuiltCommit(state.file), null);
});
