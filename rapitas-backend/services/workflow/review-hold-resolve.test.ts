/**
 * review-hold-resolve テスト
 *
 * The two resolutions a human may take on a review hold: accept the findings
 * (repair loop) or override (commit/PR proceeds, bound to this artifact+diff).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { OverridePublisher } from './publish/override-publisher';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
// Sessions as the DB would order them: findFirst honours the requested orderBy
// (and a worktreePath filter) so the test proves WHICH session is chosen.
type SessionRow = { worktreePath: string | null; createdAt: number; lastActivityAt: number };
let sessions: SessionRow[] = [];
const findFirst = mock(
  async (q: { where?: { worktreePath?: unknown }; orderBy?: Record<string, string> }) => {
    const key = Object.keys(q.orderBy ?? {})[0] as 'createdAt' | 'lastActivityAt';
    const rows = q.where?.worktreePath ? sessions.filter((s) => s.worktreePath) : sessions;
    const top = [...rows].sort((a, b) => b[key] - a[key])[0];
    return top ? { worktreePath: top.worktreePath } : null;
  },
);
mock.module('../../config/database', () => ({ prisma: { agentSession: { findFirst } } }));

const HOLD = {
  reason: 'unresolved_dispute' as const,
  detail: '検証席が判定できませんでした',
  findings: [
    {
      severity: 'blocker' as const,
      summary: 'null 未処理',
      evidence: 'a.ts:1',
      gating: true,
      verification: 'undetermined' as const,
    },
    { severity: 'minor' as const, summary: '命名', gating: false },
  ],
  severity: 90,
};
const readReviewHold = mock(async (_id: number): Promise<typeof HOLD | null> => HOLD);
const clearReviewHold = mock(async (_p: unknown) => true);
mock.module('./review-hold', () => ({
  readReviewHold,
  probeReviewHold: async () => ({ state: 'clear' }),
  clearReviewHold,
}));

const attemptVerifyRepair = mock(
  async (
    ..._a: unknown[]
  ): Promise<{
    bounced: boolean;
    newStatus?: string;
    stale?: boolean;
    cutoffRecorded?: boolean;
  }> => ({
    bounced: true,
    newStatus: 'plan_approved',
  }),
);
mock.module('./verify-self-repair', () => ({ attemptVerifyRepair }));
const markLatestExecutionFailed = mock(async () => {});
mock.module('./publish/mark-latest-execution-failed', () => ({
  markLatestExecutionFailed,
}));
const writeBlockedTask = mock(async () => {});
mock.module('./blocked-task-write', () => ({ writeBlockedTask }));
const recordTransition = mock(async (_t: Record<string, unknown>) => {});
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => '# verify' }));

const recordJuryGateCompletion = mock(async (_c: Record<string, unknown>) => {});
let sha: string | null = 'sha-5';
let fp: string | null = 'fp-5';
mock.module('./verify-jury-completion', () => ({
  readVerifySha256: async () => sha,
  recordJuryGateCompletion,
}));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => fp,
}));
let tree: string | null = 'tree-5';
const stagedTreeIdentity = mock(async (_cwd: string) => tree);
mock.module('./publish/workflow-auto-commit-tree-identity', () => ({
  stagedTreeIdentity,
  committedTreeIdentity: async () => tree,
}));
const publishAfterReviewOverride = mock(async (..._a: unknown[]) => 'completed');
mock.module('./review-hold-publish', () => ({ publishAfterReviewOverride }));
const registerVerifyCompletion = mock((_id: number, _w: Promise<unknown>) => {});
mock.module('./verify-completion-inflight', () => ({ registerVerifyCompletion }));

const { resolveReviewHold } = await import('./review-hold-resolve');

// Stand-in for the route's commit/PR operations; the service only passes it on.
const PUBLISHER = {
  performAutoCommitAndPR: async () => ({}),
  isNoChangeCompletion: () => false,
  handleVerifyGateBlocked: async () => ({}),
} as unknown as OverridePublisher;

beforeEach(() => {
  sessions = [{ worktreePath: '/wt/5', createdAt: 1, lastActivityAt: 1 }];
  sha = 'sha-5';
  fp = 'fp-5';
  tree = 'tree-5';
  stagedTreeIdentity.mockClear();
  readReviewHold.mockReset().mockResolvedValue(HOLD);
  clearReviewHold.mockReset().mockResolvedValue(true);
  attemptVerifyRepair.mockReset().mockResolvedValue({ bounced: true, newStatus: 'plan_approved' });
  writeBlockedTask.mockClear();
  recordTransition.mockClear();
  recordJuryGateCompletion.mockClear();
  publishAfterReviewOverride.mockClear();
  registerVerifyCompletion.mockClear();
});

describe('resolveReviewHold', () => {
  test('保留していなければ何もしない', async () => {
    readReviewHold.mockResolvedValue(null);
    expect(
      await resolveReviewHold({
        taskId: 5,
        action: 'accept',
        resolvedBy: 'u',
        publisher: PUBLISHER,
      }),
    ).toEqual({
      ok: false,
      reason: 'not_held',
    });
    expect(clearReviewHold).not.toHaveBeenCalled();
  });

  test('解除の CAS に負けたら何もしない（二重操作）', async () => {
    clearReviewHold.mockResolvedValue(false);
    expect(
      await resolveReviewHold({
        taskId: 5,
        action: 'override',
        resolvedBy: 'u',
        publisher: PUBLISHER,
      }),
    ).toEqual({
      ok: false,
      reason: 'cas_lost',
    });
    expect(publishAfterReviewOverride).not.toHaveBeenCalled();
  });

  test('(a) 受け入れ → 判定を決めた指摘を差し戻し理由にして修復ループへ', async () => {
    const r = await resolveReviewHold({
      taskId: 5,
      action: 'accept',
      resolvedBy: 'ユーザー操作',
      publisher: PUBLISHER,
    });
    expect(r).toEqual({
      ok: true,
      action: 'accept',
      outcome: 'bounced',
      workflowStatus: 'plan_approved',
    });
    const [taskId, status, reason, content] = attemptVerifyRepair.mock.calls[0] as [
      number,
      string,
      string,
      string,
    ];
    expect([taskId, status, content]).toEqual([5, 'verify_done', '# verify']);
    expect(reason).toContain('null 未処理');
    expect(reason).not.toContain('命名');
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'adversarial_review_failed',
        toStatus: 'plan_approved',
        metadata: expect.objectContaining({ source: 'review_hold_accept' }),
      }),
    );
    expect(writeBlockedTask).not.toHaveBeenCalled();
  });

  test('(a) 受け入れで修復上限なら blocked', async () => {
    attemptVerifyRepair.mockResolvedValue({ bounced: false });
    const r = await resolveReviewHold({
      taskId: 5,
      action: 'accept',
      resolvedBy: 'u',
      publisher: PUBLISHER,
    });
    expect(r).toMatchObject({ ok: true, outcome: 'blocked' });
    expect(writeBlockedTask).toHaveBeenCalled();
  });

  test('(b) 上書き → この成果物と差分に束ねて通過を記録し、commit/PR を背景で始める', async () => {
    const r = await resolveReviewHold({
      taskId: 5,
      action: 'override',
      resolvedBy: 'ユーザー操作',
      publisher: PUBLISHER,
    });
    expect(r).toEqual({
      ok: true,
      action: 'override',
      outcome: 'publishing',
      workflowStatus: 'verify_done',
    });
    expect(recordJuryGateCompletion).toHaveBeenCalledWith({
      taskId: 5,
      verifySha256: 'sha-5',
      diffFingerprint: 'fp-5',
      verdict: 'hold',
      outcome: 'passed',
      source: 'human_override',
    });
    // The route's publisher is what publishes — passed through untouched.
    expect(publishAfterReviewOverride).toHaveBeenCalledWith(
      5,
      '# verify',
      {
        binding: { verifySha256: 'sha-5', diffFingerprint: 'fp-5', worktreePath: '/wt/5' },
        hold: HOLD,
      },
      PUBLISHER,
    );
    // ...and it is not written into the hold's resolution record.
    expect(clearReviewHold.mock.calls[0][0]).not.toHaveProperty('publisher');
    // The resolution records the commit-stable target the completion paths
    // compare against (verify.md sha256 + publish worktree + git tree id).
    expect(clearReviewHold.mock.calls[0][0]).toMatchObject({
      target: { verifySha256: 'sha-5', treeId: 'tree-5', worktreePath: '/wt/5' },
    });
    expect(stagedTreeIdentity).toHaveBeenCalledWith('/wt/5');
    // Registered in flight so the runner's verify-settle wait sees live work.
    expect(registerVerifyCompletion.mock.calls[0][0]).toBe(5);
    expect(attemptVerifyRepair).not.toHaveBeenCalled();
  });

  test.each([
    ['verify.md の sha256', () => (sha = null)],
    ['差分の fingerprint', () => (fp = null)],
    ['差分の git tree', () => (tree = null)],
  ])('(b) 上書きで %s が取得できなければ、保留を解かず公開もしない', async (_l, unset) => {
    unset();
    const r = await resolveReviewHold({
      taskId: 5,
      action: 'override',
      resolvedBy: 'u',
      publisher: PUBLISHER,
    });
    expect(r).toEqual({ ok: false, reason: 'unbound' });
    expect(clearReviewHold).not.toHaveBeenCalled();
    expect(recordJuryGateCompletion).not.toHaveBeenCalled();
    expect(publishAfterReviewOverride).not.toHaveBeenCalled();
    expect(recordTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: 'adversarial_review_override_refused',
        toStatus: 'verify_done',
        metadata: expect.objectContaining({ reason: expect.any(String) }),
      }),
    );
  });

  test('(b) 上書きは公開処理と同じ「最後に動いたセッション」の worktree に束ねる', async () => {
    // A was created last, B was active last — commit/PR publishes from B.
    sessions = [
      { worktreePath: '/wt/A', createdAt: 9, lastActivityAt: 1 },
      { worktreePath: '/wt/B', createdAt: 1, lastActivityAt: 9 },
    ];
    await resolveReviewHold({
      taskId: 5,
      action: 'override',
      resolvedBy: 'u',
      publisher: PUBLISHER,
    });
    expect(publishAfterReviewOverride).toHaveBeenCalledWith(
      5,
      '# verify',
      expect.objectContaining({ binding: expect.objectContaining({ worktreePath: '/wt/B' }) }),
      PUBLISHER,
    );
  });

  test('(b) 公開処理が使うセッションに worktree が無ければ、上書きを受け付けない', async () => {
    // Publication would fall back to the theme directory — not what was reviewed.
    sessions = [
      { worktreePath: '/wt/A', createdAt: 1, lastActivityAt: 1 },
      { worktreePath: null, createdAt: 2, lastActivityAt: 9 },
    ];
    const r = await resolveReviewHold({
      taskId: 5,
      action: 'override',
      resolvedBy: 'u',
      publisher: PUBLISHER,
    });
    expect(r).toEqual({ ok: false, reason: 'unbound' });
    expect(clearReviewHold).not.toHaveBeenCalled();
    expect(publishAfterReviewOverride).not.toHaveBeenCalled();
  });
});
