/**
 * halt-release.test
 *
 * Fixtures are the four tasks measured stuck on 2026-09-28/29 (1105, 1107, 1110,
 * 1112): a budget halt was a one-way door, and hard-task autonomy never completed
 * a run because of it.
 *
 * Run this file on its own (as the verification gate does): bun's mock.module is
 * process-global and this file replaces the logger, the database and the
 * transition recorder.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

interface TaskRow {
  haltReason: string | null;
  workflowStatus: string | null;
}

let taskRow: TaskRow | null = null;
let updates: Array<Record<string, unknown>> = [];
let transitions: Array<Record<string, unknown>> = [];
let updateFails = false;
let recordFails = false;

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => taskRow,
      update: async (args: { data: Record<string, unknown> }) => {
        if (updateFails) throw new Error('db down');
        updates.push(args.data);
        return {};
      },
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./transition-recorder', () => ({
  recordTransition: async (input: Record<string, unknown>) => {
    if (recordFails) throw new Error('transition write failed');
    transitions.push(input);
  },
}));

const { releaseTaskHalt, releaseHaltOnHumanAnswer, HALT_RELEASED_CAUSE, MIN_HYPOTHESIS_CHARS } =
  await import('./halt-release');

const HYPOTHESIS =
  '差し戻し文言の誤誘導を修正し（2c9c3075）、実装範囲も表のセルまで広げる方針に訂正した';

beforeEach(() => {
  taskRow = { haltReason: 'budget_cost_exceeded', workflowStatus: 'plan_approved' };
  updates = [];
  transitions = [];
  updateFails = false;
  recordFails = false;
});

describe('releaseTaskHalt', () => {
  test('halt 3 列を消し、仮説付きの監査遷移を残す', async () => {
    const result = await releaseTaskHalt(1110, HYPOTHESIS, 'オペレーター代理');

    expect(result).toEqual({
      ok: true,
      taskId: 1110,
      previousHaltReason: 'budget_cost_exceeded',
      toStatus: 'plan_approved',
    });
    expect(updates).toEqual([{ haltReason: null, haltedAt: null, resumeCondition: null }]);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({
      taskId: 1110,
      actor: 'user',
      cause: HALT_RELEASED_CAUSE,
      metadata: {
        previousHaltReason: 'budget_cost_exceeded',
        hypothesis: HYPOTHESIS,
        releasedBy: 'オペレーター代理',
      },
    });
  });

  // The load-bearing half: the transition IS the window reset (halt_released is
  // in WINDOW_RESET_CAUSES), so without it the next tick re-halts on the same
  // spend — task 881/996's failure. The cause string must not drift.
  test('記録する cause は窓リセット原因と同一の文字列である', async () => {
    await releaseTaskHalt(1112, HYPOTHESIS, 'ユーザー操作');
    expect(transitions[0]?.cause).toBe('halt_released');
  });

  test('halt していないタスクは触らない（一般的な予算リセットには使えない）', async () => {
    taskRow = { haltReason: null, workflowStatus: 'in_progress' };

    expect(await releaseTaskHalt(1113, HYPOTHESIS, 'ユーザー操作')).toEqual({
      ok: false,
      reason: 'not_halted',
    });
    expect(updates).toEqual([]);
    expect(transitions).toEqual([]);
  });

  // A review hold is resolved by accept/override (review-hold.routes.ts);
  // releasing it as a cost halt would strand the task at verify_done.
  test('レビュー待ち保留は解除しない（review_hold）', async () => {
    taskRow = { haltReason: 'awaiting_review_decision', workflowStatus: 'verify_done' };
    expect(await releaseTaskHalt(1114, HYPOTHESIS, 'ユーザー操作')).toEqual({
      ok: false,
      reason: 'review_hold',
    });
    expect(updates).toEqual([]);
    expect(transitions).toEqual([]);
  });

  test('存在しないタスクは not_found', async () => {
    taskRow = null;
    expect(await releaseTaskHalt(9999, HYPOTHESIS, 'ユーザー操作')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  test('列の書き込みが失敗したら解除したと報告しない', async () => {
    updateFails = true;
    expect(await releaseTaskHalt(1110, HYPOTHESIS, 'ユーザー操作')).toEqual({
      ok: false,
      reason: 'write_failed',
    });
    expect(transitions).toEqual([]);
  });

  // Deliberate asymmetry: a runnable task with no audit line is recoverable, an
  // audit line for a release that did not happen is a lie.
  test('監査遷移の書き込みが失敗しても解除自体は成功として返す', async () => {
    recordFails = true;
    const result = await releaseTaskHalt(1110, HYPOTHESIS, 'ユーザー操作');
    expect(result.ok).toBe(true);
    expect(updates).toHaveLength(1);
  });

  test('仮説の最小長は呼び出し側が検証できるよう公開されている', () => {
    expect(MIN_HYPOTHESIS_CHARS).toBeGreaterThan(0);
  });
});

// Task 520 (2026-11-20): halted for no progress, it asked two questions and a
// person answered both, yet it stayed halted — auto-run skipped it until an
// operator released it by hand. A person's answer is the new hypothesis a
// no-progress halt asks for; it does not lift a spending ceiling.
describe('releaseHaltOnHumanAnswer', () => {
  test('releases a no-progress halt, recording the answer as the hypothesis', async () => {
    taskRow = { haltReason: 'no_progress', workflowStatus: 'research_done' };
    const released = await releaseHaltOnHumanAnswer(520, '方針Aで計画を改訂する', 'ユーザー選択');
    expect(released).toBe(true);
    expect(updates[0]).toMatchObject({ haltReason: null });
    expect(transitions[0]).toMatchObject({ cause: HALT_RELEASED_CAUSE });
    expect(JSON.stringify(transitions[0])).toContain('方針Aで計画を改訂する');
  });

  test('releases a repeat-cause halt too', async () => {
    taskRow = { haltReason: 'repeat_cause_detected', workflowStatus: 'plan_approved' };
    expect(await releaseHaltOnHumanAnswer(1, '別の原因を調べる方針にした', 'ユーザー選択')).toBe(
      true,
    );
  });

  test.each(['budget_cost_exceeded', 'budget_time_exceeded', 'budget_attempts_exceeded'])(
    'leaves %s in place — an answer is not a spending decision',
    async (haltReason) => {
      taskRow = { haltReason, workflowStatus: 'plan_approved' };
      expect(await releaseHaltOnHumanAnswer(1, '方針を変えて再開する', 'ユーザー選択')).toBe(false);
      expect(updates).toEqual([]);
    },
  );

  test('does nothing for a task that is not halted', async () => {
    taskRow = { haltReason: null, workflowStatus: 'plan_approved' };
    expect(await releaseHaltOnHumanAnswer(1, '回答', 'ユーザー選択')).toBe(false);
    expect(transitions).toEqual([]);
  });
});
