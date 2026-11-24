/**
 * CLI の差分レビューが、実際の陪審ロックと適用前の確認を通る回帰テスト（タスク1538）。
 * 最初の確認で DB がロック所有者を読み取る時点に、git や自己検証ジョブの変化を注入する。
 * 再陪審中の条件変更は、DB の受入条件を変えて実際の版の照合で検出する。
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { computeCriteriaRevision } from '../task/task-criteria-revision';

const TASK_ID = 9;
const JURY_RUN_ID = 17;
const VERIFY_SHA = 'sha-v1';
const INITIAL_TASK = {
  title: '機能を追加',
  githubPrId: null,
  workflowStatus: 'in_progress',
  haltReason: null as string | null,
  juryRunId: null as number | null,
  updatedAt: new Date(0),
  goals: null,
  constraints: null,
  acceptanceCriteria: '["初回の条件"]',
};
const initialCriteriaRevision = computeCriteriaRevision(INITIAL_TASK);

type TaskRow = typeof INITIAL_TASK;
type RunRow = {
  status: string;
  verifySha256?: string | null;
  criteriaRevision?: string | null;
  diffFingerprint?: string | null;
  discardReason?: string;
};

let taskRow = { ...INITIAL_TASK };
let runRow: RunRow | undefined;
let confirmReads = 0;
let onFirstConfirm = () => {};
let firstConfirm:
  | { juryRunId: number | null; lookupCalls: number; reviewCalls: number }
  | undefined;

const prisma = {
  task: {
    findUnique: async ({ select }: { select: { juryRunId?: boolean; updatedAt?: boolean } }) => {
      // 適用前の確認は juryRunId だけを読む。ロック取得・解放では updatedAt も読む。
      if (select.juryRunId && !select.updatedAt && ++confirmReads === 1) {
        firstConfirm = {
          juryRunId: taskRow.juryRunId,
          lookupCalls: getLatestJob.mock.calls.length,
          reviewCalls: review.mock.calls.length,
        };
        onFirstConfirm();
      }
      return { ...taskRow };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { juryRunId?: number | null; updatedAt?: Date; OR?: { haltReason: string | null }[] };
      data: Partial<TaskRow>;
    }) => {
      if ('juryRunId' in where && where.juryRunId !== taskRow.juryRunId) return { count: 0 };
      if (where.updatedAt && where.updatedAt !== taskRow.updatedAt) return { count: 0 };
      if (where.OR && !where.OR.some((filter) => filter.haltReason === taskRow.haltReason)) {
        return { count: 0 };
      }
      taskRow = { ...taskRow, ...data };
      return { count: 1 };
    },
  },
  juryReviewRun: {
    create: async ({ data }: { data: RunRow }) => {
      runRow = { ...data };
      return { id: JURY_RUN_ID };
    },
    update: async ({ data }: { data: Partial<RunRow> }) => {
      if (!runRow) throw new Error('陪審の実行が作成されていません');
      runRow = { ...runRow, ...data };
      return runRow;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: number; status: string };
      data: Partial<RunRow>;
    }) => {
      if (where.id !== JURY_RUN_ID || runRow?.status !== where.status) return { count: 0 };
      runRow = { ...runRow, ...data };
      return { count: 1 };
    },
  },
  workflowFile: { findFirst: async () => ({ sha256: VERIFY_SHA }) },
};
mock.module('../../config', () => ({ prisma }));
mock.module('../../config/database', () => ({ prisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('./transition-recorder', () => ({ recordTransition: async () => {} }));

type TimelineEvent = { eventType: string; correlationId: string; payload: Record<string, unknown> };
let timeline: TimelineEvent[] = [];
mock.module('../memory/timeline', () => ({
  appendEvent: async (event: TimelineEvent) => {
    timeline.unshift(event);
    return { id: timeline.length };
  },
  queryEvents: async (filter: { eventType: string; correlationId: string; limit: number }) => {
    const events = timeline
      .filter((e) => e.eventType === filter.eventType && e.correlationId === filter.correlationId)
      .slice(0, filter.limit);
    return { events, total: events.length };
  },
}));

let headSha = 'h1';
let currentFp = 'fp-A';
mock.module('../github/git-exec', () => ({ runGitCommand: async () => `${headSha}\n` }));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => currentFp,
}));

const passedReview = (diffFingerprint: string) => ({
  verdict: 'pass' as const,
  severity: 0,
  reasons: [],
  diffFingerprint,
});
const review = mock(async () => passedReview(currentFp));
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: review,
  isAdversarialReviewEnabled: () => true,
}));

function passedJob(runId = 'r1') {
  return {
    runId,
    taskId: TASK_ID,
    status: 'completed',
    ok: true,
    unverifiable: false,
    diffReview: {
      status: 'reviewed',
      ...passedReview('fp-A'),
      headSha: 'h1',
      criteriaRevision: initialCriteriaRevision,
    },
  };
}

let latestJob = passedJob();
const getLatestJob = mock(async () => latestJob);
mock.module('./verification-job-store', () => ({ getLatestJob }));

const { runFallbackJuryGate } = await import('./verify-fallback-jury-gate');
const { JURY_GATE_COMPLETED_EVENT } = await import('./verify-jury-completion');

const completions = () =>
  timeline.filter((e) => e.eventType === JURY_GATE_COMPLETED_EVENT).map((e) => e.payload);

const gate = () =>
  runFallbackJuryGate({
    taskId: TASK_ID,
    currentWfStatus: 'in_progress',
    verifyContent: '# verify',
    worktreePath: '/wt',
    actor: 'verifier',
    sessionId: 3,
  });

function expectInitialReuseUnderLock() {
  // 最初の確認までに照合が1回済み、陪審が未実行なら、最初の合格が選ばれている。
  expect(firstConfirm).toEqual({ juryRunId: JURY_RUN_ID, lookupCalls: 1, reviewCalls: 0 });
  expect(taskRow.juryRunId).toBeNull();
}

beforeEach(() => {
  taskRow = { ...INITIAL_TASK };
  runRow = undefined;
  timeline = [];
  headSha = 'h1';
  currentFp = 'fp-A';
  latestJob = passedJob();
  getLatestJob.mockClear();
  review.mockReset();
  review.mockImplementation(async () => passedReview(currentFp));
  confirmReads = 0;
  firstConfirm = undefined;
  onFirstConfirm = () => {};
});

describe('CLI 経路の自己検証結果の再照合', () => {
  test('C-6: 照合後に HEAD だけが変わると、陪審を1回呼び、その判定の指紋を記録する', async () => {
    onFirstConfirm = () => {
      headSha = 'h2';
    };
    review.mockResolvedValueOnce(passedReview('fp-reviewed-h2'));

    const out = await gate();

    expect(headSha).toBe('h2');
    expect(currentFp).toBe('fp-A');
    expect(review).toHaveBeenCalledTimes(1);
    expect(out.stop).toBe(false);
    expect(completions()).toEqual([
      expect.objectContaining({ diffFingerprint: 'fp-reviewed-h2', outcome: 'passed' }),
    ]);
    expect(runRow).toMatchObject({ status: 'applied', diffFingerprint: 'fp-reviewed-h2' });
    expectInitialReuseUnderLock();
  });

  test('C-7: 照合後に差分の指紋だけが変わると、陪審を1回呼ぶ', async () => {
    onFirstConfirm = () => {
      currentFp = 'fp-B';
    };

    const out = await gate();

    expect(headSha).toBe('h1');
    expect(currentFp).toBe('fp-B');
    expect(review).toHaveBeenCalledTimes(1);
    expect(out.stop).toBe(false);
    expect(completions()).toEqual([
      expect.objectContaining({ diffFingerprint: 'fp-B', outcome: 'passed' }),
    ]);
    expectInitialReuseUnderLock();
  });

  test('C-7b: 照合後に別の自己検証ジョブが合格すると、陪審を1回呼ぶ', async () => {
    onFirstConfirm = () => {
      latestJob = passedJob('r2');
    };

    await gate();

    expect(review).toHaveBeenCalledTimes(1);
    expectInitialReuseUnderLock();
  });

  test('C-8: 照合後に何も変わらなければ、陪審を呼ばず合格の完了記録を1件残す', async () => {
    const out = await gate();

    expect(review).toHaveBeenCalledTimes(0);
    expect(out.stop).toBe(false);
    expect(confirmReads).toBe(1);
    expect(completions()).toEqual([
      expect.objectContaining({ diffFingerprint: 'fp-A', outcome: 'passed' }),
    ]);
    expect(runRow).toMatchObject({ status: 'applied', diffFingerprint: 'fp-A' });
    expectInitialReuseUnderLock();
  });

  test('C-9: 再陪審中に受入条件が変わると、2回目の確認で判定を破棄する', async () => {
    onFirstConfirm = () => {
      headSha = 'h2';
    };
    review.mockImplementationOnce(async () => {
      taskRow.acceptanceCriteria = '["再陪審中に変更した条件"]';
      return passedReview(currentFp);
    });

    const out = await gate();

    expect(review).toHaveBeenCalledTimes(1);
    expect(out.stop).toBe(true);
    expect(confirmReads).toBe(2);
    expect(completions()).toHaveLength(0);
    expect(taskRow.haltReason).toBe('jury_result_discarded');
    expect(runRow).toMatchObject({
      status: 'discarded_stale',
      criteriaRevision: initialCriteriaRevision,
    });
    expect(JSON.parse(runRow?.discardReason ?? 'null')).toEqual({
      drift: [
        {
          field: 'criteriaRevision',
          before: initialCriteriaRevision,
          after: computeCriteriaRevision(taskRow),
        },
      ],
    });
    expectInitialReuseUnderLock();
  });
});
