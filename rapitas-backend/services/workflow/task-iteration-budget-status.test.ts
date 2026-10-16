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

  test('同一 status の再記録は数え、halt 側 cause は除外される', () => {
    const seq = [
      t('in_progress', 'in_progress'),
      t('in_progress', 'in_progress', 'iteration_budget_halted'),
    ];
    expect(countNonAdvancingTransitions(seq, isHaltSideTransitionCause)).toBe(1);
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
