/**
 * task-iteration-budget-status テスト
 *
 * 条件①（前進しなかった遷移の数）の集計を検証する。task 984/986 のように
 * reset→再実行で同じ status を複数回通っても反復とみなさないこと、真の往復は
 * 検知し続けることを固定する。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  countNonAdvancingTransitions,
  isResetTransitionCause,
  type StatusTransitionSample,
} from './task-iteration-budget-status';
import { isHaltSideTransitionCause, resolveIterationBudgetState } from './task-iteration-budget';

// 運用者の .env(暫定 6/8、ATTEMPTS_BUDGET=20 等)に依存せず既定閾値で検証する
const ENV_KEYS = [
  'RAPITAS_ITERATION_NO_PROGRESS_STATUS_REPEAT_MIN',
  'RAPITAS_ITERATION_NO_PROGRESS_ATTEMPTS_MIN',
  'RAPITAS_ITERATION_ATTEMPTS_BUDGET',
  'RAPITAS_ITERATION_TIME_BUDGET_MS',
  'RAPITAS_TASK_BUDGET_USD',
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const t = (
  fromStatus: string | null,
  toStatus: string,
  cause: string | null = 'phase_completed',
): StatusTransitionSample => ({ fromStatus, toStatus, cause });

/** A verify_repair bounce carrying the reason the system recorded. */
const r = (fromStatus: string, toStatus: string, reason: string): StatusTransitionSample => ({
  fromStatus,
  toStatus,
  cause: 'verify_repair',
  reason,
});

describe('isResetTransitionCause', () => {
  test('reset 系 cause を判定する', () => {
    for (const c of [
      'stale_terminal_reset',
      'blocked_auto_retry',
      'task_retried',
      'reconciler_requeue',
      'reconciler_reset_undispatchable',
    ]) {
      expect(isResetTransitionCause(c)).toBe(true);
    }
    expect(isResetTransitionCause('verify_repair')).toBe(false);
    expect(isResetTransitionCause(null)).toBe(false);
  });
});

describe('countNonAdvancingTransitions', () => {
  test('空配列は 0', () => {
    expect(countNonAdvancingTransitions([])).toBe(0);
  });

  test('984/986 相当: reset を挟んだ 2 周の前進遷移は 0', () => {
    const seq = [
      t('draft', 'research_done'),
      t('research_done', 'in_progress'),
      t('in_progress', 'verify_done'),
      t('verify_done', 'draft', 'stale_terminal_reset'),
      t('draft', 'research_done'),
      t('research_done', 'in_progress'),
      t('in_progress', 'verify_done'),
    ];
    expect(countNonAdvancingTransitions(seq, isHaltSideTransitionCause)).toBe(0);
  });

  test('verify_done↔in_progress の往復は後退数を数える', () => {
    const seq = [
      t('in_progress', 'verify_done'),
      t('verify_done', 'in_progress', 'verify_repair'),
      t('in_progress', 'verify_done'),
      t('verify_done', 'in_progress', 'verify_repair'),
    ];
    expect(countNonAdvancingTransitions(seq)).toBe(2);
  });

  // task 514 (2026-11-20): 9 件のうち 4 件は plan_critic_incomplete・
  // task_spend_notice・verifier_eligibility_deferred のような同じ status の
  // 記録で、状態を動かさない帳簿付けだった。足踏みの証拠にはならない。
  test('同じ原因の同一 status 記録が繰り返されたら 2 回目から数える', () => {
    const seq = [
      t('verify_done', 'verify_done', 'verify_pr_not_created'),
      t('verify_done', 'verify_done', 'verify_pr_not_created'),
      t('verify_done', 'verify_done', 'verify_pr_not_created'),
    ];
    expect(countNonAdvancingTransitions(seq)).toBe(2);
  });

  test('同一 status の記録は、原因ごとに初回は数えない（帳簿付けの記録であり後退ではない）', () => {
    const seq = [
      t('plan_created', 'plan_created', 'plan_critic_incomplete'),
      t('in_progress', 'in_progress', 'task_spend_notice'),
      t('verify_done', 'verify_done', 'verifier_eligibility_deferred'),
      t('in_progress', 'in_progress', 'iteration_budget_halted'),
    ];
    expect(countNonAdvancingTransitions(seq, isHaltSideTransitionCause)).toBe(0);
  });

  // task 514: 差分レビューが毎回別の不備（実行権限、ポート重複…）を指摘し、
  // それを直していた。新しい理由の差し戻しは進展であり、止めるべきは同じ
  // 理由で戻され続けるときだけ。
  test('理由が毎回違う差し戻しは数えない', () => {
    const seq = [
      r('verify_done', 'plan_approved', 'start.sh に実行権限がない'),
      r('verify_done', 'plan_approved', 'Web ポートに API と同じ 8090 を指定できる'),
      r('verify_done', 'plan_approved', 'bind 失敗の扱いが無い'),
    ];
    expect(countNonAdvancingTransitions(seq)).toBe(0);
  });

  test('同じ理由で戻されたら 2 回目から数える（数字の違いは同じ理由とみなす）', () => {
    const seq = [
      r('verify_done', 'plan_approved', 'テスト 12 件が失敗'),
      r('verify_done', 'plan_approved', 'テスト 13 件が失敗'),
      r('verify_done', 'plan_approved', 'テスト 12 件が失敗'),
    ];
    expect(countNonAdvancingTransitions(seq)).toBe(2);
  });

  test('fromStatus が null / 未知 status は数えない', () => {
    expect(
      countNonAdvancingTransitions([t(null, 'draft'), t('weird', 'draft'), t('draft', 'weird')]),
    ).toBe(0);
  });
});

describe('既定閾値での no_progress 判定', () => {
  const base = { nowMs: 1_700_000_000_000, windowStartMs: 1_700_000_000_000 - 60_000, spentUsd: 0 };

  test('前進のみ(count 0)なら attempts 5 でも halt しない', () => {
    const s = resolveIterationBudgetState({
      ...base,
      attemptsInWindow: 5,
      repeatLoop: null,
      statusRepeatCount: 0,
    });
    expect(s.shouldHalt).toBe(false);
  });

  test('往復 2 回 + attempts 3 は no_progress で diagnostics を返す', () => {
    const s = resolveIterationBudgetState({
      ...base,
      attemptsInWindow: 3,
      repeatLoop: null,
      statusRepeatCount: 2,
    });
    expect(s.haltReason).toBe('no_progress');
    expect(s.diagnostics).toEqual({ statusRepeatCount: 2, attempts: 3, repeatLoop: null });
  });
});

// The DB row carries the reason inside metadata (a JSON string), not a field.
describe('countNonAdvancingTransitions — reason from metadata', () => {
  test('reads verify_repair reason out of the metadata JSON', () => {
    const m = (reason: string): StatusTransitionSample => ({
      fromStatus: 'verify_done',
      toStatus: 'plan_approved',
      cause: 'verify_repair',
      metadata: JSON.stringify({ attempt: 1, reason }),
    });
    expect(countNonAdvancingTransitions([m('権限がない'), m('ポートが重複する')])).toBe(0);
    expect(countNonAdvancingTransitions([m('権限がない'), m('権限がない')])).toBe(1);
  });
});

describe('countNonAdvancingTransitions — questions and critic reasons', () => {
  // task 514: five of its counted transitions were questions waiting for a person.
  test('a question pausing for a person is not a step back', () => {
    expect(
      countNonAdvancingTransitions([
        t('plan_approved', 'awaiting_question', 'file_saved:question'),
        t('plan_approved', 'awaiting_question', 'file_saved:question'),
      ]),
    ).toBe(0);
  });

  test("reads a critic's reasons array, so a new critique is not a repeat", () => {
    const c = (reasons: string[]): StatusTransitionSample => ({
      fromStatus: 'research_done',
      toStatus: 'draft',
      cause: 'research_critic_failed',
      metadata: JSON.stringify({ severity: 55, reasons }),
    });
    expect(countNonAdvancingTransitions([c(['根拠が無い']), c(['範囲が広すぎる'])])).toBe(0);
  });
});

test('bookkeeping records never count, however often they repeat', () => {
  const seq = [
    t('plan_created', 'plan_created', 'plan_critic_incomplete'),
    t('plan_created', 'plan_created', 'plan_critic_incomplete'),
    t('in_progress', 'in_progress', 'task_spend_notice'),
    t('in_progress', 'in_progress', 'task_spend_notice'),
    t('verify_done', 'verify_done', 'verifier_eligibility_deferred'),
    t('verify_done', 'verify_done', 'verifier_eligibility_deferred'),
  ];
  expect(countNonAdvancingTransitions(seq)).toBe(0);
});
