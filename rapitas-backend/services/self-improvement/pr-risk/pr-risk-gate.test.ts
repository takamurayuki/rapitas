/**
 * pr-risk-gate test
 *
 * Pins the staged rollout: off = no gh call; display = comment only;
 * hold/auto = exclude from auto-merge when score ≥ threshold (merge mode
 * only); head-SHA caching; and fail-open on every error.
 */
import { describe, it, expect } from 'bun:test';
import { evaluatePrRisk, type PrRiskGateDeps } from './pr-risk-gate';
import { createFakeDb } from './pr-risk-fake-db.test-helpers';
import { writeConfig } from './pr-risk-store';
import { COMMENT_MARKER, type PrRiskStage } from './pr-risk-types';

const AGENT = { taskId: 1, agentAuthored: true };
const noopLog = { warn: () => {}, info: () => {} };

// A lockfile + schema change on a big diff → prior score ≈ 0.88 (main factor file_size).
const RISKY = {
  additions: 5000,
  deletions: 100,
  changedFiles: 40,
  files: [{ path: 'bun.lock' }, { path: 'rapitas-backend/prisma/schema/a.prisma' }],
  headRefOid: 'sha1',
  url: 'https://github.com/o/r/pull/5',
};

async function setup(stage: PrRiskStage, threshold = 0.5, pr = RISKY) {
  const { db, tables } = createFakeDb();
  await writeConfig(db, { stage, threshold });
  const calls: string[][] = [];
  const deps: PrRiskGateDeps = {
    db,
    log: noopLog,
    now: () => new Date('2026-09-22T00:00:00Z'),
    runGh: async (args) => {
      calls.push(args);
      if (args[0] === 'pr') return JSON.stringify(pr);
      if (args.includes('--method')) return '{}';
      return '[]';
    },
  };
  return { db, tables, calls, deps };
}

describe('evaluatePrRisk — stages', () => {
  it('off: returns immediately without calling gh', async () => {
    const s = await setup('off');
    expect(await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps)).toEqual({ hold: false });
    expect(s.calls).toHaveLength(0);
    expect(s.tables.prRiskScore.rows).toHaveLength(0);
  });

  it('display: scores, stores, comments with SHAP — never holds', async () => {
    const s = await setup('display');
    const r = await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps);
    expect(r.hold).toBe(false);
    expect(s.tables.prRiskScore.rows).toHaveLength(1);
    expect(s.tables.prRiskScore.rows[0]).toMatchObject({
      repo: 'o/r',
      headSha: 'sha1',
      held: false,
    });
    expect(s.tables.prOutcome.rows).toHaveLength(1);
    const post = s.calls.find((c) => c.includes('POST'));
    expect(post?.find((a) => a.startsWith('body='))).toContain(COMMENT_MARKER);
    expect(post?.find((a) => a.startsWith('body='))).toContain('SHAP');
    expect(s.tables.prRiskScore.rows[0].commentPostedAt).toBeInstanceOf(Date);
  });

  it('hold: excludes a high-score PR from auto-merge in merge mode', async () => {
    const s = await setup('hold');
    const r = await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps);
    expect(r.hold).toBe(true);
    expect(r.detail).toContain('file_size');
    expect(s.tables.prRiskScore.rows[0].held).toBe(true);
  });

  it('hold: does not hold below the threshold', async () => {
    const s = await setup('hold', 0.99);
    expect((await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps)).hold).toBe(false);
  });

  it('auto: holds like hold', async () => {
    const s = await setup('auto');
    expect((await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps)).hold).toBe(true);
  });

  it('pr mode: comments but never holds', async () => {
    const s = await setup('hold');
    expect((await evaluatePrRisk('/repo', 5, 'pr', AGENT, s.deps)).hold).toBe(false);
    expect(s.calls.some((c) => c.includes('POST'))).toBe(true);
  });
});

describe('evaluatePrRisk — author feature', () => {
  it('scores a human PR (agentAuthored=false) with author = 1', async () => {
    const s = await setup('display');
    await evaluatePrRisk('/repo', 5, 'merge', { taskId: null, agentAuthored: false }, s.deps);
    const row = s.tables.prRiskScore.rows[0];
    expect(JSON.parse(row.featuresJson as string).author).toBe(1);
    expect(row.taskId).toBeNull();
  });
});

describe('evaluatePrRisk — caching and fail-open', () => {
  it('reuses the score for the same head SHA and does not re-comment', async () => {
    const s = await setup('display');
    await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps);
    const before = s.calls.length;
    await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps);
    expect(s.tables.prRiskScore.rows).toHaveLength(1);
    expect(s.calls.length - before).toBe(1); // only the pr view
  });

  it('fails open when gh fails', async () => {
    const s = await setup('hold');
    s.deps.runGh = async () => {
      throw new Error('gh down');
    };
    expect(await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps)).toEqual({ hold: false });
  });

  it('fails open when the DB delegates are missing (pre-restart client)', async () => {
    const s = await setup('hold');
    const deps = { ...s.deps, db: {} as PrRiskGateDeps['db'] };
    expect(await evaluatePrRisk('/repo', 5, 'merge', AGENT, deps)).toEqual({ hold: false });
  });

  it('still holds when only the comment upsert fails', async () => {
    const s = await setup('hold');
    const orig = s.deps.runGh;
    s.deps.runGh = async (args, cwd) => {
      if (args[0] === 'api') throw new Error('comment 403');
      return orig(args, cwd);
    };
    expect((await evaluatePrRisk('/repo', 5, 'merge', AGENT, s.deps)).hold).toBe(true);
    expect(s.tables.prRiskScore.rows[0].commentPostedAt).toBeNull();
  });
});
