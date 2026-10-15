/**
 * pr-risk-outcome test
 *
 * Pins the strict failure definition: a matching revert within the CLOSED 72h
 * window after merge, or an operator-registered critical incident. CI red and
 * late reverts are NOT failures.
 */
import { describe, it, expect } from 'bun:test';
import {
  classifyOutcome,
  matchesRevert,
  parseRevertLog,
  collectOutcomes,
  type OutcomeDeps,
  type PendingPr,
} from './pr-risk-outcome';

const H = 3600 * 1000;
const MERGED = new Date('2026-09-01T00:00:00Z');
const at = (ms: number) => new Date(MERGED.getTime() + ms);
const LONG_AFTER = at(30 * 24 * H);

describe('classifyOutcome — 72h window', () => {
  const revert = (ms: number) => [{ sha: 'r1', at: at(ms) }];

  it('72h00m00s exactly is a failure (closed interval)', () => {
    const r = classifyOutcome({
      mergedAt: MERGED,
      reverts: revert(72 * H),
      incident: false,
      now: LONG_AFTER,
    });
    expect(r).toMatchObject({ label: 'failure', failureKind: 'rollback_72h', revertSha: 'r1' });
  });

  it('71h59m59s is a failure', () => {
    const r = classifyOutcome({
      mergedAt: MERGED,
      reverts: revert(72 * H - 1000),
      incident: false,
      now: LONG_AFTER,
    });
    expect(r.label).toBe('failure');
  });

  it('72h00m01s is NOT a failure → success once the window has elapsed', () => {
    const r = classifyOutcome({
      mergedAt: MERGED,
      reverts: revert(72 * H + 1000),
      incident: false,
      now: LONG_AFTER,
    });
    expect(r).toMatchObject({ label: 'success', failureKind: null });
  });

  it('ignores a "revert" dated before the merge', () => {
    const r = classifyOutcome({
      mergedAt: MERGED,
      reverts: revert(-H),
      incident: false,
      now: LONG_AFTER,
    });
    expect(r.label).toBe('success');
  });

  it('is pending until 72h have elapsed without a revert', () => {
    expect(
      classifyOutcome({ mergedAt: MERGED, reverts: [], incident: false, now: at(71 * H) }).label,
    ).toBe('pending');
    expect(
      classifyOutcome({ mergedAt: MERGED, reverts: [], incident: false, now: at(72 * H) }).label,
    ).toBe('success');
  });

  it('is pending when the PR has not been merged', () => {
    expect(
      classifyOutcome({ mergedAt: null, reverts: [], incident: false, now: LONG_AFTER }).label,
    ).toBe('pending');
  });

  it('a critical incident is a failure regardless of timing', () => {
    const r = classifyOutcome({ mergedAt: MERGED, reverts: [], incident: true, now: at(H) });
    expect(r).toMatchObject({ label: 'failure', failureKind: 'critical_incident' });
  });
});

describe('matchesRevert', () => {
  const pr = { number: 42, title: 'feat(x): add y', mergeSha: 'abc123', commitShas: ['c1', 'c2'] };

  it('matches "This reverts commit <mergeSha>"', () => {
    expect(
      matchesRevert(
        { sha: 'r', subject: 'Revert something', body: 'This reverts commit abc123.' },
        pr,
      ),
    ).toBe(true);
  });

  it('matches "This reverts commit <PR commit sha>"', () => {
    expect(matchesRevert({ sha: 'r', subject: 'x', body: 'This reverts commit c2.' }, pr)).toBe(
      true,
    );
  });

  it('matches an exact Revert "<title>" subject', () => {
    expect(matchesRevert({ sha: 'r', subject: 'Revert "feat(x): add y"', body: '' }, pr)).toBe(
      true,
    );
  });

  it('matches a Revert subject carrying (#42)', () => {
    expect(matchesRevert({ sha: 'r', subject: 'Revert "whatever" (#42)', body: '' }, pr)).toBe(
      true,
    );
  });

  it('does not match other PRs, unrelated shas or non-revert subjects', () => {
    expect(matchesRevert({ sha: 'r', subject: 'Revert "other" (#420)', body: '' }, pr)).toBe(false);
    expect(matchesRevert({ sha: 'r', subject: 'x', body: 'This reverts commit zzz999.' }, pr)).toBe(
      false,
    );
    expect(matchesRevert({ sha: 'r', subject: 'fix: follow-up (#42)', body: '' }, pr)).toBe(false);
  });
});

describe('parseRevertLog', () => {
  it('parses %H%x1f%cI%x1f%B%x1e records', () => {
    const out = `aaa\x1f2026-09-02T00:00:00Z\x1fRevert "t"\n\nThis reverts commit abc.\n\x1e\nbbb\x1f2026-09-03T00:00:00Z\x1ffix: z\n\x1e`;
    const commits = parseRevertLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ sha: 'aaa', subject: 'Revert "t"' });
    expect(commits[0].body).toContain('This reverts commit abc.');
    expect(commits[1].at.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });
});

describe('collectOutcomes', () => {
  const pending: PendingPr = { repo: 'o/r', prNumber: 42, incidentNote: null };
  const makeDeps = (over: Partial<OutcomeDeps> = {}): OutcomeDeps & { saved: unknown[] } => {
    const saved: unknown[] = [];
    return {
      saved,
      now: () => LONG_AFTER,
      viewPr: async () => ({
        title: 'feat(x): add y',
        mergedAt: MERGED.toISOString(),
        mergeSha: 'abc123',
        baseBranch: 'develop',
        commitShas: ['c1'],
      }),
      gitLog: async () => `r9\x1f${at(10 * H).toISOString()}\x1fRevert "feat(x): add y"\n\x1e`,
      saveOutcome: async (row) => {
        saved.push(row);
      },
      ...over,
    };
  };

  it('labels a PR reverted within 72h as failure and persists it', async () => {
    const deps = makeDeps();
    expect(await collectOutcomes([pending], deps)).toBe(1);
    expect(deps.saved[0]).toMatchObject({
      repo: 'o/r',
      prNumber: 42,
      label: 'failure',
      failureKind: 'rollback_72h',
      revertSha: 'r9',
    });
  });

  it('does not count still-pending PRs and survives per-PR errors', async () => {
    const deps = makeDeps({
      viewPr: async (_repo, n) => {
        if (n === 1) throw new Error('gh down');
        return {
          title: 't',
          mergedAt: at(0).toISOString(),
          mergeSha: 'm',
          baseBranch: 'develop',
          commitShas: [],
        };
      },
      now: () => at(H),
      gitLog: async () => '',
    });
    const n = await collectOutcomes([{ ...pending, prNumber: 1 }, pending], deps);
    expect(n).toBe(0);
    expect(deps.saved[0]).toMatchObject({ prNumber: 42, label: 'pending' });
  });
});
