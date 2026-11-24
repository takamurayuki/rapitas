/**
 * review-hold-resolve.in-progress.test
 *
 * A hold written by a pending diff review stays at in_progress (task 1538).
 * Resolving it must still work and never pass through verify_done wrongly:
 * an override moves in_progress → verify_done in ONE compare-and-swap and
 * publishes; an accept bounces from in_progress. The CLI fallback keeps
 * holding at verify_done, and a second hold never moves an in_progress hold.
 * The real review-hold, review-hold-status and review-hold-resolve run; only
 * the DB (one-row fake) and the side effects are mocked.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test';
import type { OverridePublisher } from './publish/override-publisher';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noop, logger: noop }));

type Row = { workflowStatus: string; status: string; haltReason: string | null };
let row: Row;
const statusWrites: string[] = [];
type Where = {
  workflowStatus?: string;
  status?: { in: string[] };
  haltReason?: string | null;
  OR?: Array<{ haltReason: string | null }>;
};
function matches(w: Where): boolean {
  if (w.workflowStatus !== undefined && w.workflowStatus !== row.workflowStatus) return false;
  if (w.status && !w.status.in.includes(row.status)) return false;
  if (w.haltReason !== undefined && w.haltReason !== row.haltReason) return false;
  if (w.OR && !w.OR.some((c) => c.haltReason === row.haltReason)) return false;
  return true;
}
const fakePrisma = {
  task: {
    findUnique: mock(async () => ({ ...row })),
    updateMany: mock(async (a: { where: Where; data: Partial<Row> }) => {
      if (!matches(a.where)) return { count: 0 };
      if (a.data.workflowStatus) statusWrites.push(a.data.workflowStatus);
      row = { ...row, ...a.data };
      return { count: 1 };
    }),
  },
  workflowTransition: {
    findFirst: mock(async () => ({
      metadata: JSON.stringify({
        holdReason: 'unresolved_dispute',
        detail: '検証席が判定できませんでした',
        findings: [],
        severity: 80,
        criteriaRevision: 'crit-1',
      }),
    })),
  },
};
mock.module('../../config/database', () => ({ prisma: fakePrisma }));
mock.module('../../config', () => ({ prisma: fakePrisma }));

const transitions: Array<{ cause: string; fromStatus: string | null; toStatus: string }> = [];
mock.module('./transition-recorder', () => ({
  recordTransition: mock(async (t: (typeof transitions)[number]) => {
    transitions.push(t);
  }),
}));
const TARGET = {
  verifySha256: 'sha-1',
  treeId: 'tree-1',
  worktreePath: '/wt',
  criteriaRevision: 'crit-1',
};
let overrideTarget: Record<string, unknown> = { ...TARGET };
mock.module('./review-hold-records', () => ({
  parseHoldMetadata: (raw: unknown) => (typeof raw === 'string' ? JSON.parse(raw) : {}),
  readOverrideTarget: () => null,
  overrideTargetDrift: async () => null,
  appendHoldEvent: async () => {},
  readCurrentOverrideTarget: async () => overrideTarget,
}));
mock.module('../task/task-criteria-revision', () => ({
  readCriteriaRevision: async () => 'crit-1',
}));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => 'fp-1',
  fingerprintDiff: () => 'fp-1',
}));
mock.module('./verify-jury-completion', () => ({
  readVerifySha256: async () => 'sha-1',
  recordJuryGateCompletion: mock(async () => {}),
}));
const publish = mock(async (..._a: unknown[]) => 'completed');
mock.module('./review-hold-publish', () => ({ publishAfterReviewOverride: publish }));
mock.module('./verify-completion-inflight', () => ({ registerVerifyCompletion: () => {} }));
const repair = mock(async (..._a: unknown[]) => ({ bounced: true, newStatus: 'plan_approved' }));
mock.module('./verify-self-repair', () => ({ attemptVerifyRepair: repair }));
mock.module('./publish/mark-latest-execution-failed', () => ({
  markLatestExecutionFailed: async () => {},
}));
mock.module('./blocked-task-write', () => ({ writeBlockedTask: async () => {} }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: async () => '# verify' }));

const { resolveReviewHold, REVIEW_OVERRIDE_REFUSED_CAUSE } = await import('./review-hold-resolve');
const { holdFromReview, holdForHumanReview } = await import('./review-hold');
const { REVIEW_HOLD_HALT_REASON, REVIEW_HOLD_CAUSE, probeReviewHold } =
  await import('./review-hold-status');

const PUBLISHER = {} as unknown as OverridePublisher;
const HELD_REVIEW = {
  severity: 80,
  reasons: ['人の判断が必要'],
  awaitingHuman: { reason: 'unresolved_dispute' as const, detail: 'x' },
};

beforeEach(() => {
  row = {
    workflowStatus: 'in_progress',
    status: 'in-progress',
    haltReason: REVIEW_HOLD_HALT_REASON,
  };
  statusWrites.length = 0;
  transitions.length = 0;
  overrideTarget = { ...TARGET };
  publish.mockClear();
  repair.mockClear();
});

describe('in_progress review hold', () => {
  test('in_progress の保留も保留として読める', async () => {
    const p = await probeReviewHold(1);
    expect(p.state).toBe('held');
    expect(p.state === 'held' && p.hold.heldStatus).toBe('in_progress');
  });

  test('H-2: 上書きは in_progress → verify_done の1回の比較更新で解除して公開する', async () => {
    const r = await resolveReviewHold({
      taskId: 1,
      action: 'override',
      resolvedBy: 'op',
      publisher: PUBLISHER,
    });
    expect(r).toMatchObject({ ok: true, outcome: 'publishing' });
    expect(statusWrites).toEqual(['verify_done']);
    expect(row).toMatchObject({ workflowStatus: 'verify_done', haltReason: null });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  test('H-2: 上書きの前に完了済みへ移っていれば cas_lost で公開しない', async () => {
    const { readReviewHold } = await import('./review-hold-status');
    const hold = await readReviewHold(1);
    expect(hold).not.toBeNull();
    row = { ...row, workflowStatus: 'completed' };
    const { clearReviewHold } = await import('./review-hold');
    const cleared = await clearReviewHold({
      taskId: 1,
      action: 'override',
      resolvedBy: 'op',
      hold: hold!,
      advanceTo: 'verify_done',
    });
    expect(cleared).toBe(false);
    expect(statusWrites).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(0);
  });

  test('H-3: 受け入れは in_progress から差し戻し、verify_done を書かない', async () => {
    const r = await resolveReviewHold({
      taskId: 1,
      action: 'accept',
      resolvedBy: 'op',
      publisher: PUBLISHER,
    });
    expect(r).toMatchObject({ ok: true, action: 'accept', outcome: 'bounced' });
    expect(repair.mock.calls[0][1]).toBe('in_progress');
    expect(statusWrites).not.toContain('verify_done');
    const failed = transitions.find((t) => t.cause === 'adversarial_review_failed');
    expect(failed).toMatchObject({ fromStatus: 'in_progress', toStatus: 'plan_approved' });
  });

  test('H-5: CLI の fallback の保留は従来どおり verify_done に移す', async () => {
    row = { workflowStatus: 'in_progress', status: 'in-progress', haltReason: null };
    const r = await holdFromReview({
      taskId: 1,
      review: HELD_REVIEW,
      source: 'cli_epilogue',
      fromStatus: 'in_progress',
    });
    expect(r).toBe('held');
    expect(row.workflowStatus).toBe('verify_done');
    const t = transitions.find((x) => x.cause === REVIEW_HOLD_CAUSE);
    expect(t).toMatchObject({ fromStatus: 'in_progress', toStatus: 'verify_done' });
  });

  test('H-5: in_progress の保留に別の保留（keep 無し）を重ねても状態は変わらない', async () => {
    const r = await holdForHumanReview({
      taskId: 1,
      fromStatus: 'in_progress',
      reason: 'ineligible_verifier',
      detail: 'y',
      findings: [],
      source: 'verifier_eligibility',
    });
    expect(r).toBe('cas_lost');
    expect(row.workflowStatus).toBe('in_progress');
    expect(statusWrites).toEqual([]);
  });

  test('レビュー待ちの HTTP の保留は in_progress のまま書く', async () => {
    row = { workflowStatus: 'in_progress', status: 'in-progress', haltReason: null };
    const r = await holdFromReview({
      taskId: 1,
      review: HELD_REVIEW,
      source: 'http_save',
      fromStatus: 'in_progress',
    });
    expect(r).toBe('held');
    expect(row).toMatchObject({
      workflowStatus: 'in_progress',
      haltReason: REVIEW_HOLD_HALT_REASON,
    });
    expect(statusWrites).not.toContain('verify_done');
  });

  test.each([
    ['unbound', { missing: '公開処理が使う worktree が見つかりません' }],
    ['criteria_changed_since', { ...TARGET, criteriaRevision: 'crit-2' }],
  ] as const)('H-6: 上書きの拒否（%s）でも in_progress の保留は残る', async (reason, target) => {
    overrideTarget = { ...target };
    const r = await resolveReviewHold({
      taskId: 1,
      action: 'override',
      resolvedBy: 'op',
      publisher: PUBLISHER,
    });
    expect(r).toEqual({ ok: false, reason });
    expect(row).toMatchObject({
      workflowStatus: 'in_progress',
      haltReason: REVIEW_HOLD_HALT_REASON,
    });
    expect(statusWrites).toEqual([]);
    expect(publish).toHaveBeenCalledTimes(0);
    expect(transitions.at(-1)).toMatchObject({
      cause: REVIEW_OVERRIDE_REFUSED_CAUSE,
      fromStatus: 'in_progress',
      toStatus: 'in_progress',
    });
    expect(REVIEW_OVERRIDE_REFUSED_CAUSE).toBe('adversarial_review_override_refused');
  });
});
