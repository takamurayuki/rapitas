/**
 * task-iteration-budget テスト
 *
 * resolveIterationBudgetState（純粋関数）の単体テスト。各予算軸の単独超過・
 * 優先順位・除外ガード・forgiveness budget超過だが進展ありケースを検証する。
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import {
  isHaltSideTransitionCause,
  resolveIterationBudgetState,
  type IterationBudgetInput,
} from './task-iteration-budget';

describe('isHaltSideTransitionCause', () => {
  test('この予算自身の halt と hang backstop の遷移は停止側として除外対象', () => {
    // 2026-09-20 task 984/985: the halt wrote a same-status transition every
    // tick, which then counted as the "repeated cause" for the next halt.
    expect(isHaltSideTransitionCause('iteration_budget_halted')).toBe(true);
    expect(isHaltSideTransitionCause('auto_run_hang_backstop')).toBe(true);
  });

  test('作業側の遷移(修復バウンス・保存・retry)は除外しない', () => {
    for (const cause of [
      'verify_repair',
      'ci_repair',
      'file_saved:verify',
      'task_retried',
      null,
      undefined,
    ]) {
      expect(isHaltSideTransitionCause(cause)).toBe(false);
    }
  });
});

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

const BASE_NOW_MS = 1_700_000_000_000;

function baseInput(overrides: Partial<IterationBudgetInput> = {}): IterationBudgetInput {
  return {
    nowMs: BASE_NOW_MS,
    windowStartMs: BASE_NOW_MS - 60_000, // 1分前 — 各予算の既定閾値には全く届かない
    spentUsd: 0,
    attemptsInWindow: 0,
    repeatLoop: null,
    statusRepeatCount: 0,
    ...overrides,
  };
}

describe('resolveIterationBudgetState', () => {
  test('全軸が予算内なら停止しない', () => {
    const result = resolveIterationBudgetState(baseInput());
    expect(result).toEqual({ shouldHalt: false });
  });

  test('時間予算超過(24時間既定)で budget_time_exceeded', () => {
    const result = resolveIterationBudgetState(
      baseInput({ windowStartMs: BASE_NOW_MS - 25 * 60 * 60 * 1000 }),
    );
    expect(result.shouldHalt).toBe(true);
    expect(result.haltReason).toBe('budget_time_exceeded');
  });

  test('費用予算超過(既定$25)で budget_cost_exceeded', () => {
    const result = resolveIterationBudgetState(baseInput({ spentUsd: 30 }));
    expect(result.shouldHalt).toBe(true);
    expect(result.haltReason).toBe('budget_cost_exceeded');
  });

  // task 1031 (2026-09-22): the second implementer run ended at $46 and the
  // cost halt fired BEFORE its verification, parking the whole spend unverified.
  test('実装完了・検証待ち(pendingVerification)なら費用超過でも停止せず検証を通す', () => {
    const result = resolveIterationBudgetState(
      baseInput({ spentUsd: 46, pendingVerification: true }),
    );
    expect(result).toEqual({ shouldHalt: false });
  });

  test('検証待ちの猶予は費用軸だけ — 時間・試行回数の超過は従来どおり停止', () => {
    expect(
      resolveIterationBudgetState(
        baseInput({ windowStartMs: BASE_NOW_MS - 25 * 60 * 60 * 1000, pendingVerification: true }),
      ).haltReason,
    ).toBe('budget_time_exceeded');
    expect(
      resolveIterationBudgetState(baseInput({ attemptsInWindow: 9, pendingVerification: true }))
        .haltReason,
    ).toBe('budget_attempts_exceeded');
  });

  test('試行回数予算超過(既定8件)で budget_attempts_exceeded', () => {
    const result = resolveIterationBudgetState(baseInput({ attemptsInWindow: 9 }));
    expect(result.shouldHalt).toBe(true);
    expect(result.haltReason).toBe('budget_attempts_exceeded');
  });

  test('同一原因反復検出 + 進展なし条件①③成立で repeat_cause_detected', () => {
    const result = resolveIterationBudgetState(
      baseInput({
        repeatLoop: { cause: 'verify_repair', count: 4 },
        statusRepeatCount: 2,
        attemptsInWindow: 3,
      }),
    );
    expect(result.shouldHalt).toBe(true);
    expect(result.haltReason).toBe('repeat_cause_detected');
    expect(result.resumeCondition?.requiresNewHypothesis).toBe(true);
  });

  test('forgiveness budget超過だが進展あり(条件③未成立)のケースは停止しない', () => {
    const result = resolveIterationBudgetState(
      baseInput({
        repeatLoop: { cause: 'verify_repair', count: 4 },
        statusRepeatCount: 2,
        attemptsInWindow: 1, // no-progress条件③(既定3件)未満 = 正常な修復サイクル中
      }),
    );
    expect(result.shouldHalt).toBe(false);
  });

  test('反復シグネチャなしで条件①③成立時は no_progress', () => {
    const result = resolveIterationBudgetState(
      baseInput({ repeatLoop: null, statusRepeatCount: 2, attemptsInWindow: 3 }),
    );
    expect(result.shouldHalt).toBe(true);
    expect(result.haltReason).toBe('no_progress');
  });

  test('複数軸同時超過時は time > cost > attempts > repeat_cause > no_progress の優先順位', () => {
    const result = resolveIterationBudgetState(
      baseInput({
        windowStartMs: BASE_NOW_MS - 25 * 60 * 60 * 1000,
        spentUsd: 30,
        attemptsInWindow: 9,
        repeatLoop: { cause: 'verify_repair', count: 4 },
        statusRepeatCount: 2,
      }),
    );
    expect(result.haltReason).toBe('budget_time_exceeded');
  });

  test('isWorkflowManaged=false は他軸の超過に関わらず停止しない', () => {
    const result = resolveIterationBudgetState(
      baseInput({
        isWorkflowManaged: false,
        windowStartMs: BASE_NOW_MS - 25 * 60 * 60 * 1000,
        spentUsd: 999,
        attemptsInWindow: 999,
      }),
    );
    expect(result.shouldHalt).toBe(false);
  });

  test('manuallyWithdrawn=true は他軸の超過に関わらず停止しない', () => {
    const result = resolveIterationBudgetState(
      baseInput({ manuallyWithdrawn: true, spentUsd: 999, attemptsInWindow: 999 }),
    );
    expect(result.shouldHalt).toBe(false);
  });

  test('themeAutoRunEnabled=false は他軸の超過に関わらず停止しない', () => {
    const result = resolveIterationBudgetState(
      baseInput({ themeAutoRunEnabled: false, spentUsd: 999, attemptsInWindow: 999 }),
    );
    expect(result.shouldHalt).toBe(false);
  });
});
