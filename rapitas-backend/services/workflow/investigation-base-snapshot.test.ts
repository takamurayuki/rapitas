/**
 * investigation-base-snapshot.test
 *
 * 2026-11-21: trendline's primary checkout sat on master from 2026-07-09, 43
 * commits behind develop (theme 18's base). Researchers and the criteria
 * review read that checkout, so tasks were researched against July code —
 * 1523 was filed with "web/ has no tests" (it has 19) and 1524 was told
 * scripts/pidfile.mjs did not exist.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { resolveInvestigationWorkDir, type SnapshotDeps } from './investigation-base-snapshot';

const ROOT = 'C:/repo';

function world(opts: {
  head: string;
  tip: string | null;
  clean?: boolean;
  existing?: string[];
  fetchFails?: boolean;
}) {
  const calls: string[][] = [];
  const dirs = new Set(opts.existing ?? []);
  const deps: SnapshotDeps = {
    git: async (args, cwd) => {
      calls.push([cwd, ...args]);
      const a = args.join(' ');
      if (a.startsWith('fetch')) {
        if (opts.fetchFails) throw new Error('offline');
        return '';
      }
      if (a === 'rev-parse HEAD') return `${opts.head}\n`;
      if (a.startsWith('rev-parse --verify')) {
        if (!opts.tip) throw new Error('unknown ref');
        return `${opts.tip}\n`;
      }
      if (a === 'status --porcelain') return opts.clean === false ? ' M x\n' : '';
      if (a.startsWith('worktree add')) {
        dirs.add(args[args.length - 2]);
        return '';
      }
      if (a.startsWith('worktree remove')) {
        dirs.delete(args[args.length - 1]);
        return '';
      }
      return '';
    },
    exists: (p) => dirs.has(p),
    listSnapshots: () => [...dirs].filter((d) => d.includes('_base-')),
  };
  return { deps, calls, dirs };
}

const TIP = 'b'.repeat(40);

describe('resolveInvestigationWorkDir', () => {
  test('reads the primary checkout when it already sits clean on the base tip', async () => {
    const { deps, calls } = world({ head: TIP, tip: TIP });
    expect(await resolveInvestigationWorkDir(ROOT, 'develop', deps)).toBe(ROOT);
    expect(calls.some((c) => c.includes('worktree'))).toBe(false);
  });

  test('reads a snapshot of origin/<base> when the primary checkout is elsewhere', async () => {
    const { deps, calls } = world({ head: 'a'.repeat(40), tip: TIP });
    const dir = await resolveInvestigationWorkDir(ROOT, 'develop', deps);
    expect(dir).toBe(join(ROOT, '.worktrees', `_base-${TIP.slice(0, 12)}`));
    const add = calls.find((c) => c[1] === 'worktree' && c[2] === 'add');
    expect(add).toEqual([ROOT, 'worktree', 'add', '--detach', dir, TIP]);
  });

  test('uses a snapshot when the primary checkout has local edits on the tip', async () => {
    const { deps } = world({ head: TIP, tip: TIP, clean: false });
    expect(await resolveInvestigationWorkDir(ROOT, 'develop', deps)).not.toBe(ROOT);
  });

  test('reuses an existing snapshot of the same commit', async () => {
    const dir = join(ROOT, '.worktrees', `_base-${TIP.slice(0, 12)}`);
    const { deps, calls } = world({ head: 'a'.repeat(40), tip: TIP, existing: [dir] });
    expect(await resolveInvestigationWorkDir(ROOT, 'develop', deps)).toBe(dir);
    expect(calls.some((c) => c[2] === 'add')).toBe(false);
  });

  test('keeps only the two newest snapshots', async () => {
    const old = ['1', '2', '3'].map((n) => join(ROOT, '.worktrees', `_base-${n.repeat(12)}`));
    const { deps, dirs } = world({ head: 'a'.repeat(40), tip: TIP, existing: old });
    await resolveInvestigationWorkDir(ROOT, 'develop', deps);
    expect([...dirs].filter((d) => d.includes('_base-')).length).toBeLessThanOrEqual(2);
    expect([...dirs]).toContain(join(ROOT, '.worktrees', `_base-${TIP.slice(0, 12)}`));
  });

  test('falls back to the primary checkout when the base ref is unknown', async () => {
    const { deps } = world({ head: 'a'.repeat(40), tip: null });
    expect(await resolveInvestigationWorkDir(ROOT, 'develop', deps)).toBe(ROOT);
  });

  test('still snapshots the cached ref when fetch fails (offline)', async () => {
    const { deps } = world({ head: 'a'.repeat(40), tip: TIP, fetchFails: true });
    expect(await resolveInvestigationWorkDir(ROOT, 'develop', deps)).not.toBe(ROOT);
  });

  test('leaves things alone without a base branch', async () => {
    const { deps, calls } = world({ head: 'a'.repeat(40), tip: TIP });
    expect(await resolveInvestigationWorkDir(ROOT, null, deps)).toBe(ROOT);
    expect(calls).toHaveLength(0);
  });
});
