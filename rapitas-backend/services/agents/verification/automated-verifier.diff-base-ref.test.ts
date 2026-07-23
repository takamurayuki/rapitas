/**
 * automated-verifier.diff-base-ref.test
 *
 * diffBaseRef is a duplicate of diff-structured.ts's resolveBaseRef (same
 * develop→main→master guess, now also preferring an explicit
 * preferredBaseBranch first). Separated from automated-verifier.test.ts,
 * which is pure-function-only — this exercises real git subprocess calls
 * against a throwaway repo, same as diff-structured.test.ts's equivalent
 * suite.
 *
 * Regression (task 506): a stale/divergent 'develop' branch made the
 * guess-only order land on an ancient common ancestor, pulling unrelated
 * pre-existing commits into "this task's changed files" — which this file's
 * getAllChangedFiles/getChangedCodeFiles feed into HARD gates (tamperCheck,
 * lint, typecheck), so a wrong base here can false-block a task on files the
 * agent never touched, not just add noise to an LLM judge prompt.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { diffBaseRef } from './automated-verifier';

describe('diffBaseRef — preferredBaseBranch overrides the develop/main/master guess', () => {
  let repoDir: string;
  let mainTrackSha: string;

  function run(cmd: string): string {
    return execSync(cmd, { cwd: repoDir }).toString().trim();
  }

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'diffbaseref-test-'));
    run('git init -q');
    run('git config user.email "test@example.com"');
    run('git config user.name "Test"');

    writeFileSync(join(repoDir, 'README.md'), 'initial\n');
    run('git add README.md');
    run('git commit -q -m "root"');

    // 'develop' branches off HERE and is never updated again (stale/frozen).
    run('git branch develop');

    // 'main' keeps moving after develop diverged.
    writeFileSync(join(repoDir, 'unrelated.txt'), 'unrelated\n');
    run('git add unrelated.txt');
    run('git commit -q -m "unrelated feature"');
    mainTrackSha = run('git rev-parse HEAD');
    run('git branch main-track');

    run('git checkout -q -b feature/task');
    writeFileSync(join(repoDir, 'task-change.txt'), 'task change\n');
    run('git add task-change.txt');
    run('git commit -q -m "task change"');
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  test('without a preference, the develop guess resolves to the stale root commit', async () => {
    const base = await diffBaseRef(repoDir);
    const rootSha = run('git rev-list --max-parents=0 HEAD');
    expect(base).toBe(rootSha);
  });

  test('with preferredBaseBranch="main-track", resolves to the actual fork point', async () => {
    const base = await diffBaseRef(repoDir, 'main-track');
    expect(base).toBe(mainTrackSha);
  });

  test('an unsafe/malformed preferredBaseBranch is ignored, falling back to the guess', async () => {
    const base = await diffBaseRef(repoDir, '; rm -rf /');
    const rootSha = run('git rev-list --max-parents=0 HEAD');
    expect(base).toBe(rootSha);
  });
});
