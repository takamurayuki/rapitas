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
