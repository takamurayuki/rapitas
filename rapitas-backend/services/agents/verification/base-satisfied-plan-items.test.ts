/**
 * base-satisfied-plan-items.test
 *
 * Runs the helper against a real throwaway git repo: a plan item whose change
 * already sits on the base ref must be recognised, while anything absent from
 * base (or not provable) must stay a failure.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findBaseSatisfiedReasons } from './base-satisfied-plan-items';

let repo = '';
let baseRef = '';

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'base-satisfied-'));
  git(['init', '-q']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  mkdirSync(join(repo, 'src'));
  writeFileSync(
    join(repo, 'src', 'aux-cli-ownership.ts'),
    'export function f(resolved: string | null) {\n  if (!resolved) return false;\n  return true;\n}\n',
  );
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  baseRef = git(['rev-parse', 'HEAD']);
}, 60_000);

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const run = (reasons: string[], over: { plan?: string; changed?: string[] } = {}) =>
  findBaseSatisfiedReasons({
    reasons,
    planContent: over.plan ?? '',
    changedFiles: over.changed ?? ['src/other.ts'],
    cwd: repo,
    baseRef,
  });

describe('findBaseSatisfiedReasons', () => {
  it('treats an item already on the base ref as satisfied (bare filename + line suffix)', async () => {
    const r = await run([
      '受入基準1: 計画の中核 `aux-cli-ownership.ts:2` の `if (!resolved) return false;` が差分に無い',
    ]);
    expect(r.remaining).toEqual([]);
    expect(r.satisfied).toHaveLength(1);
    expect(r.satisfied[0]!.path).toBe('src/aux-cli-ownership.ts');
    expect(r.satisfied[0]!.anchors).toEqual(['if (!resolved) return false;']);
  });

  it('takes anchors from plan lines when the reason carries none', async () => {
    const r = await run(['`src/aux-cli-ownership.ts` の修正が差分に無い'], {
      plan: '- [ ] `src/aux-cli-ownership.ts` に `if (!resolved) return false;` を入れる',
    });
    expect(r.satisfied).toHaveLength(1);
    expect(r.remaining).toEqual([]);
  });

  it('keeps the failure when the anchor is absent from base (neither base nor diff has it)', async () => {
    const reason = '`src/aux-cli-ownership.ts` の `normalizeOwner(` が差分に無い';
    const r = await run([reason]);
    expect(r.satisfied).toEqual([]);
    expect(r.remaining).toEqual([reason]);
  });

  it('does not accept bare file existence without any anchor', async () => {
    const reason = '`src/aux-cli-ownership.ts` の変更が差分に無い';
    const r = await run([reason]);
    expect(r.satisfied).toEqual([]);
    expect(r.remaining).toEqual([reason]);
  });

  it('requires every anchor to match (partial match is not satisfied)', async () => {
    const reason = '`src/aux-cli-ownership.ts` の `if (!resolved) return false;` と `missingFn()`';
    const r = await run([reason]);
    expect(r.satisfied).toEqual([]);
    expect(r.remaining).toEqual([reason]);
  });

  it('defers to the jury when the diff itself touches the file', async () => {
    const reason = '`src/aux-cli-ownership.ts` の `if (!resolved) return false;` が不十分';
    const r = await run([reason], { changed: ['src/aux-cli-ownership.ts'] });
    expect(r.satisfied).toEqual([]);
    expect(r.remaining).toEqual([reason]);
  });

  it('splits a mixed set and keeps unpaired reasons', async () => {
    const ok = '`src/aux-cli-ownership.ts` の `if (!resolved) return false;` が無い';
    const bad = '`src/never-existed.ts` の `foo(bar)` が無い';
    const r = await run([ok, bad, 'テストが不足している']);
    expect(r.satisfied.map((s) => s.reason)).toEqual([ok]);
    expect(r.remaining).toEqual([bad, 'テストが不足している']);
  });

  it('fails closed when git cannot resolve the base ref', async () => {
    const reason = '`src/aux-cli-ownership.ts` の `if (!resolved) return false;` が無い';
    const r = await findBaseSatisfiedReasons({
      reasons: [reason],
      planContent: '',
      changedFiles: [],
      cwd: repo,
      baseRef: 'no-such-ref-xyz',
    });
    expect(r.satisfied).toEqual([]);
    expect(r.remaining).toEqual([reason]);
  });
});
