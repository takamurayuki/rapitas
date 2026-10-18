/**
 * primary-fast-forward.test
 *
 * Covers the fast-forward the self-restart depends on. The cases that matter
 * are the ones where it must NOT act: the self-development system edits the
 * primary checkout concurrently, so a dirty tree is the normal case, not an
 * edge case, and a diverged checkout breaks every task branch's tamper check.
 */
import { describe, test, expect } from 'bun:test';
import { fastForwardPrimary, type GitRun } from './primary-fast-forward';

/** A git stub: each `<file> <args joined>` key maps to stdout, or throws. */
function git(responses: Record<string, string | Error>): { run: GitRun; calls: string[] } {
  const calls: string[] = [];
  const run: GitRun = async (args) => {
    const key = args.join(' ');
    calls.push(key);
    const hit = Object.entries(responses).find(([k]) => key.startsWith(k));
    const value = hit?.[1];
    if (value instanceof Error) throw value;
    return value ?? '';
  };
  return { run, calls };
}

const CLEAN = { 'status --porcelain': '' };
const BEHIND = {
  ...CLEAN,
  'rev-parse HEAD': 'aaa111\n',
  'rev-parse origin/develop': 'bbb222\n',
  'merge-base --is-ancestor': '',
};

describe('fastForwardPrimary', () => {
  test('fast-forwards a clean checkout that is behind, and says HEAD moved', async () => {
    const { run, calls } = git(BEHIND);
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(true);
    expect(r.reason).toBe('fast-forwarded');
    expect(calls.some((c) => c.startsWith('merge --ff-only origin/develop'))).toBe(true);
  });

  test('leaves a dirty checkout alone — the self-dev system edits it concurrently', async () => {
    const { run, calls } = git({ 'status --porcelain': ' M services/foo.ts\n' });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('dirty');
    expect(calls.some((c) => c.startsWith('merge --ff-only'))).toBe(false);
  });

  test('runs no merge when already up to date', async () => {
    const { run, calls } = git({
      ...CLEAN,
      'rev-parse HEAD': 'aaa111\n',
      'rev-parse origin/develop': 'aaa111\n',
    });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('up-to-date');
    expect(calls.some((c) => c.startsWith('merge --ff-only'))).toBe(false);
  });

  test('leaves a diverged checkout alone rather than forcing it', async () => {
    // Diverging the primary makes every task branch look tampered with and
    // turns every sync into a conflict. Never force, never reset.
    const { run, calls } = git({
      ...CLEAN,
      'rev-parse HEAD': 'aaa111\n',
      'rev-parse origin/develop': 'bbb222\n',
      'merge-base --is-ancestor': new Error('not an ancestor'),
    });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('diverged');
    // `merge-base` also starts with "merge", so match the merge itself.
    expect(calls.some((c) => c.startsWith('merge --ff-only'))).toBe(false);
  });

  test('survives a failing fetch without merging or throwing', async () => {
    const { run, calls } = git({ ...CLEAN, fetch: new Error('ENETUNREACH') });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('fetch-failed');
    expect(calls.some((c) => c.startsWith('merge --ff-only'))).toBe(false);
  });

  test('reports a failed merge rather than claiming it moved', async () => {
    const { run } = git({ ...BEHIND, 'merge --ff-only': new Error('refusing') });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('merge-failed');
  });

  test('follows RAPITAS_PRIMARY_BRANCH, matching the branch dev.js pins', async () => {
    const previous = process.env.RAPITAS_PRIMARY_BRANCH;
    process.env.RAPITAS_PRIMARY_BRANCH = 'main';
    try {
      const { run, calls } = git({
        ...CLEAN,
        'rev-parse HEAD': 'aaa111\n',
        'rev-parse origin/main': 'bbb222\n',
        'merge-base --is-ancestor': '',
      });
      const r = await fastForwardPrimary({ run });
      expect(r.moved).toBe(true);
      expect(calls.some((c) => c.startsWith('fetch origin main'))).toBe(true);
      expect(calls.some((c) => c.startsWith('merge --ff-only origin/main'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.RAPITAS_PRIMARY_BRANCH;
      else process.env.RAPITAS_PRIMARY_BRANCH = previous;
    }
  });

  test('reports rather than throws when the checkout is not a git repository', async () => {
    const { run } = git({ 'status --porcelain': new Error('not a git repository') });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('status-failed');
  });
});

// 実測 2026-10-18 (#1060): rapitas-frontend の `predev` が起動のたびに
// generate-messages.mjs を回して messages/{ja,en}.json を書き換える。出力が
// コミット済みの内容と少しでも違えば primary は dev サーバー起動の瞬間から
// dirty になり、同期がその一行で永久に降り続ける。実際、6本のマージが
// 丸一日反映されず、primary は起動時のコミットに留まっていた。
describe('generated-file drift', () => {
  const DIRTY_GENERATED =
    ' M rapitas-frontend/messages/ja.json\n M rapitas-frontend/messages/en.json\n';

  test('生成物だけが dirty なら復元して同期を続ける', async () => {
    const { run, calls } = git({
      'status --porcelain': DIRTY_GENERATED,
      'rev-parse HEAD': 'aaa111\n',
      'rev-parse origin/develop': 'bbb222\n',
    });
    const r = await fastForwardPrimary({ run });

    expect(r.moved).toBe(true);
    expect(r.reason).toBe('fast-forwarded');
    expect(r.restoredGenerated).toEqual([
      'rapitas-frontend/messages/ja.json',
      'rapitas-frontend/messages/en.json',
    ]);
    expect(calls.some((c) => c.startsWith('checkout -- rapitas-frontend/messages/ja.json'))).toBe(
      true,
    );
  });

  // 人の作業中のファイルは今までどおり一切触らない。復元は生成物限定。
  test('生成物以外が混ざっていたら触らず dirty を返す', async () => {
    const { run, calls } = git({
      'status --porcelain':
        ' M rapitas-frontend/messages/ja.json\n M rapitas-backend/services/foo.ts\n',
    });
    const r = await fastForwardPrimary({ run });

    expect(r.moved).toBe(false);
    expect(r.reason).toBe('dirty');
    expect(r.dirtyPaths).toContain('rapitas-backend/services/foo.ts');
    expect(calls.some((c) => c.startsWith('checkout --'))).toBe(false);
  });

  test('dirty の内訳を返す（通知と診断がそれを出せるように）', async () => {
    const { run } = git({ 'status --porcelain': ' M some/other/file.ts\n' });
    const r = await fastForwardPrimary({ run });
    expect(r.dirtyPaths).toEqual(['some/other/file.ts']);
  });

  // 復元できなければ、黙って進めず今までどおり止まる。
  test('復元に失敗したら dirty として止まる', async () => {
    const { run } = git({
      'status --porcelain': DIRTY_GENERATED,
      'checkout --': new Error('checkout failed'),
    });
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(false);
    expect(r.reason).toBe('dirty');
  });

  test('クリーンなツリーでは何も復元しない', async () => {
    const { run, calls } = git(BEHIND);
    const r = await fastForwardPrimary({ run });
    expect(r.moved).toBe(true);
    expect(r.restoredGenerated).toEqual([]);
    expect(calls.some((c) => c.startsWith('checkout --'))).toBe(false);
  });
});
