/**
 * blocked-retry-resume-stage.facts.test
 *
 * Pins loadResumeFacts (task 1563): stage source order, PR matching by number, and the
 * rule that an unreadable fact is unknown (leave), never absent (draft). The pure
 * decision table is in blocked-retry-resume-stage.test.ts.
 */
import { describe, test, expect } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';
import { decideResumeStage, loadResumeFacts } from './blocked-retry-resume-stage';

describe('loadResumeFacts', () => {
  const prisma = (over: Record<string, unknown> = {}) =>
    ({
      workflowTransition: { findFirst: async () => null },
      task: { findUnique: async () => ({ workingDirectory: '/w', githubPrId: 9 }) },
      gitHubPullRequest: { findFirst: async () => ({ state: 'open' }) },
      ...over,
    }) as unknown as PrismaClient;

  test('作業ディレクトリ・PR・未プッシュ件数を集める', async () => {
    const f = await loadResumeFacts(
      prisma(),
      { id: 1, workflowStatus: 'in_progress' },
      { dirExists: () => true, unpushed: async () => 3 },
    );
    expect(f).toEqual({
      stage: 'in_progress',
      stageSource: 'workflow_status',
      blockedCause: null,
      dirExists: true,
      hasPr: true,
      prState: 'open',
      unpushedCommits: 3,
    });
  });

  const blockedFrom = (fromStatus: string) => ({
    workflowTransition: { findFirst: async () => ({ fromStatus }) },
  });

  test('workflowStatus が null なら blocked に入った遷移の fromStatus を使う', async () => {
    const f = await loadResumeFacts(prisma(blockedFrom('in_progress')), {
      id: 1,
      workflowStatus: null,
    });
    expect(f.stage).toBe('in_progress');
    expect(f.stageSource).toBe('blocked_transition');
  });

  test('blocked に入った遷移の fromStatus は現在の workflowStatus より優先する（段階の第一候補）', async () => {
    const f = await loadResumeFacts(prisma(blockedFrom('plan_approved')), {
      id: 1,
      workflowStatus: 'draft',
    });
    expect(f.stage).toBe('plan_approved');
    expect(f.stageSource).toBe('blocked_transition');
    expect(decideResumeStage(f).kind).toBe('keep_stage');
  });

  test('遷移も履歴も得られなければ現在の workflowStatus を使う', async () => {
    const f = await loadResumeFacts(prisma(), { id: 1, workflowStatus: 'plan_created' });
    expect(f.stage).toBe('plan_created');
    expect(f.stageSource).toBe('workflow_status');
  });

  test('履歴の読み取りが失敗しても現在の workflowStatus にフォールバックする', async () => {
    const f = await loadResumeFacts(
      prisma({ workflowTransition: { findFirst: async () => Promise.reject(new Error('down')) } }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(f.stage).toBe('in_progress');
    expect(f.stageSource).toBe('workflow_status');
  });

  test('読み取りに失敗しても例外にせず、保守的な値（作業なし）を返す', async () => {
    const f = await loadResumeFacts(
      prisma({ task: { findUnique: async () => Promise.reject(new Error('down')) } }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(f.dirExists).toBe(false);
    expect(f.prState).toBeNull();
  });

  /** A table that honours the `where` filter the loader sends. */
  const prTable = (
    rows: Array<{ linkedTaskId: number; prNumber: number; state: string; updatedAt: number }>,
  ) => ({
    findFirst: async (args: { where: { linkedTaskId: number; prNumber?: number } }) =>
      rows
        .filter(
          (r) =>
            r.linkedTaskId === args.where.linkedTaskId &&
            (args.where.prNumber === undefined || r.prNumber === args.where.prNumber),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null,
  });
  const twoPrs = [
    { linkedTaskId: 1, prNumber: 41, state: 'merged', updatedAt: 3 },
    { linkedTaskId: 1, prNumber: 42, state: 'open', updatedAt: 2 },
  ];

  test('現在の PR（Task.githubPrId）を採る: 更新が新しい旧 merged PR より open の現 PR を優先する', async () => {
    const f = await loadResumeFacts(
      prisma({
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: 42 }) },
        gitHubPullRequest: prTable(twoPrs),
      }),
      { id: 1, workflowStatus: 'verify_done' },
    );
    expect(f.prState).toBe('open');
    expect(decideResumeStage(f).kind).toBe('merge_wait');
  });

  test('githubPrId に一致する行が無ければ state は不明（別の PR の merged で完了にしない）', async () => {
    const f = await loadResumeFacts(
      prisma({
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: 99 }) },
        gitHubPullRequest: prTable(twoPrs),
      }),
      { id: 1, workflowStatus: 'verify_done' },
    );
    expect(f.prState).toBeNull();
    expect(f.hasPr).toBe(true);
    expect(decideResumeStage(f).kind).toBe('leave');
  });

  test('githubPrId が無ければ紐づく最新の PR を使う', async () => {
    const f = await loadResumeFacts(
      prisma({
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: null }) },
        gitHubPullRequest: prTable(twoPrs),
      }),
      { id: 1, workflowStatus: 'verify_done' },
    );
    expect(f.prState).toBe('merged');
  });

  test('段階が全く決められず作業が残っていれば leave（draft にして捨てない）', async () => {
    const f = await loadResumeFacts(
      prisma(blockedFrom('in-progress')),
      { id: 1, workflowStatus: null },
      { dirExists: () => true },
    );
    expect(f.stage).toBeNull();
    expect(f.stageSource).toBe('unknown');
    expect(decideResumeStage(f).kind).toBe('leave');
  });

  test('段階が決められず作業も無ければ draft', async () => {
    const f = await loadResumeFacts(
      prisma({
        ...blockedFrom('in-progress'),
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: null }) },
        gitHubPullRequest: { findFirst: async () => null },
      }),
      { id: 1, workflowStatus: null },
    );
    expect(decideResumeStage(f).kind).toBe('draft');
  });

  test('blocked へ入った遷移が Task.status の語彙なら、それ以前に入った最後の段階まで遡る', async () => {
    const f = await loadResumeFacts(
      prisma({
        workflowTransition: {
          findFirst: async (a: { where: { toStatus: unknown } }) =>
            a.where.toStatus === 'blocked'
              ? { fromStatus: 'in-progress' }
              : { toStatus: 'plan_approved' },
        },
      }),
      { id: 1, workflowStatus: null },
      { dirExists: () => true },
    );
    expect(f.stage).toBe('plan_approved');
  });

  test('PR の照会が失敗しても Task.githubPrId が示す PR を失わず、state は不明（verify_done は leave）', async () => {
    const f = await loadResumeFacts(
      prisma({
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: 42 }) },
        gitHubPullRequest: { findFirst: async () => Promise.reject(new Error('db down')) },
      }),
      { id: 1, workflowStatus: 'verify_done' },
    );
    expect(f.hasPr).toBe(true);
    expect(f.prState).toBeNull();
    expect(decideResumeStage(f).kind).toBe('leave');
  });

  test('PR の照会が失敗しても作業ディレクトリと未プッシュ件数は集める', async () => {
    const f = await loadResumeFacts(
      prisma({ gitHubPullRequest: { findFirst: async () => Promise.reject(new Error('down')) } }),
      { id: 1, workflowStatus: 'in_progress' },
      { dirExists: () => true, unpushed: async () => 2 },
    );
    expect(f.dirExists).toBe(true);
    expect(f.unpushedCommits).toBe(2);
  });

  test('履歴補完は blocked に入った時刻より前の段階だけを採用する（その後の draft は採らない）', async () => {
    const blockedAt = new Date('2026-11-27T01:00:00Z');
    const history = [
      { toStatus: 'plan_approved', createdAt: new Date('2026-11-27T00:00:00Z') },
      { toStatus: 'draft', createdAt: new Date('2026-11-27T02:00:00Z') }, // retry artefact
    ];
    const f = await loadResumeFacts(
      prisma({
        workflowTransition: {
          findFirst: async (a: { where: { toStatus: unknown; createdAt?: { lt: Date } } }) => {
            if (a.where.toStatus === 'blocked') {
              return { fromStatus: 'in-progress', createdAt: blockedAt };
            }
            const lt = a.where.createdAt?.lt;
            return (
              [...history]
                .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
                .find((h) => !lt || h.createdAt < lt) ?? null
            );
          },
        },
      }),
      { id: 1, workflowStatus: null },
      { dirExists: () => true },
    );
    expect(f.stage).toBe('plan_approved');
    expect(f.stageSource).toBe('history');
  });

  test('Task 行の読み取りが失敗したら「作業なし」とは断定せず leave（draft にしない）', async () => {
    const f = await loadResumeFacts(
      prisma({
        ...blockedFrom('in_progress'),
        task: { findUnique: async () => Promise.reject(new Error('down')) },
      }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(f.workUnknown).toBe(true);
    expect(decideResumeStage(f).kind).toBe('leave');
  });

  test('PR 照会が失敗し作業の証拠も無いときも leave（不明と不存在を区別する）', async () => {
    const f = await loadResumeFacts(
      prisma({
        ...blockedFrom('in_progress'),
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: null }) },
        gitHubPullRequest: { findFirst: async () => Promise.reject(new Error('down')) },
      }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(f.workUnknown).toBe(true);
    expect(decideResumeStage(f).kind).toBe('leave');
  });

  test('すべて読めて作業が本当に無ければ draft（workUnknown は立たない）', async () => {
    const f = await loadResumeFacts(
      prisma({
        ...blockedFrom('in_progress'),
        task: { findUnique: async () => ({ workingDirectory: null, githubPrId: null }) },
        gitHubPullRequest: { findFirst: async () => null },
      }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(f.workUnknown).toBeUndefined();
    expect(decideResumeStage(f).kind).toBe('draft');
  });

  test('blocked に入った遷移の cause を blockedCause として集める（読めなければ null）', async () => {
    const withCause = await loadResumeFacts(
      prisma({
        workflowTransition: {
          findFirst: async () => ({ fromStatus: 'in_progress', cause: 'auto_run_hang_backstop' }),
        },
      }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(withCause.blockedCause).toBe('auto_run_hang_backstop');
    const noRow = await loadResumeFacts(prisma(), { id: 1, workflowStatus: 'in_progress' });
    expect(noRow.blockedCause).toBeNull();
    const failed = await loadResumeFacts(
      prisma({ workflowTransition: { findFirst: async () => Promise.reject(new Error('down')) } }),
      { id: 1, workflowStatus: 'in_progress' },
    );
    expect(failed.blockedCause).toBeUndefined();
  });

  test('段階 null かつ Task 行の読取失敗は leave（draft にしない）', async () => {
    const f = await loadResumeFacts(
      prisma({ task: { findUnique: async () => Promise.reject(new Error('down')) } }),
      { id: 1, workflowStatus: null },
    );
    expect(f.stage).toBeNull();
    expect(f.workUnknown).toBe(true);
    expect(decideResumeStage(f).kind).toBe('leave');
  });
});
