/**
 * stall-summary テスト
 *
 * 原因推測（inferStallCause）と音声向け要約（summarizeStall）の純関数検証。
 */
import { describe, it, expect } from 'bun:test';
import {
  inferStallCause,
  summarizeStall,
  truncateTitleForNarration,
  type StallVerbosity,
} from './stall-summary';
import type { GatheredTaskState } from './self-incident-evidence';

function makeState(overrides: Partial<GatheredTaskState> = {}): GatheredTaskState {
  return {
    taskId: 1,
    title: 'テストタスク',
    taskUpdatedAtMs: 0,
    timeline: [],
    latestTransitionAtMs: null,
    windowedCauses: [],
    latestSessionId: null,
    latestSessionStatus: null,
    latestExecutionId: null,
    latestExecutionStatus: null,
    hasLiveExecution: false,
    hasAnyExecution: false,
    hasActiveQueueItem: false,
    ...overrides,
  };
}

describe('truncateTitleForNarration', () => {
  it('40文字以下のタイトルはそのまま返すこと', () => {
    expect(truncateTitleForNarration('短いタイトル')).toBe('短いタイトル');
  });

  it('40文字を超えるタイトルは省略記号付きで切り詰めること', () => {
    const long = 'あ'.repeat(60);
    const result = truncateTitleForNarration(long);
    expect(result).toBe(`${'あ'.repeat(40)}…`);
  });
});

describe('inferStallCause', () => {
  it('中断済み実行がある場合 → resume を先頭に提案すること', () => {
    const result = inferStallCause(
      makeState({ latestExecutionStatus: 'interrupted', latestSessionId: 1, hasAnyExecution: true }),
      'in_progress',
    );
    expect(result.suggestedActions[0]).toBe('resume');
    expect(result.cause).toContain('中断');
  });

  it('失敗した実行がある場合 → requeue を提案すること', () => {
    const result = inferStallCause(
      makeState({ latestExecutionStatus: 'failed', latestSessionId: 1, hasAnyExecution: true }),
      'in_progress',
    );
    expect(result.suggestedActions[0]).toBe('requeue');
    expect(result.suggestedActions).not.toContain('resume');
  });

  it('セッション進行中扱いなのに実行が無い場合 → interrupt を先頭に提案すること', () => {
    const result = inferStallCause(
      makeState({
        latestSessionId: 1,
        latestSessionStatus: 'active',
        hasLiveExecution: false,
        hasAnyExecution: true,
      }),
      'in_progress',
    );
    expect(result.suggestedActions[0]).toBe('interrupt');
  });

  it('plan_created で停滞している場合 → 承認待ちを原因に挙げること', () => {
    const result = inferStallCause(makeState({ hasAnyExecution: true }), 'plan_created');
    expect(result.cause).toContain('承認待ち');
  });

  it('起動記録が皆無の場合 → 起動記録なしを原因に挙げること', () => {
    const result = inferStallCause(makeState(), 'research_done');
    expect(result.cause).toContain('起動記録');
  });

  it('どのケースでも破壊的操作 clear_git_lock を末尾に必ず含むこと', () => {
    const cases: [GatheredTaskState, string | null][] = [
      [makeState({ latestExecutionStatus: 'interrupted' }), null],
      [makeState({ latestExecutionStatus: 'failed' }), null],
      [makeState(), 'plan_created'],
      [makeState(), null],
    ];
    for (const [state, wf] of cases) {
      const { suggestedActions } = inferStallCause(state, wf);
      expect(suggestedActions[suggestedActions.length - 1]).toBe('clear_git_lock');
    }
  });
});

describe('summarizeStall', () => {
  const state = makeState({
    title: '長時間停滞しているタスク',
    latestSessionStatus: 'interrupted',
    latestExecutionStatus: 'interrupted',
    timeline: [
      {
        createdAt: '2026-08-16T00:00:00.000Z',
        fromStatus: 'plan_approved',
        toStatus: 'in_progress',
        actor: 'system',
        cause: 'auto_advance',
        phase: 'implement',
      },
    ],
  });
  const cause = 'エージェント実行が中断されたまま再開されていない可能性があります';

  it('concise は タスク名＋停滞分数のみで cause を含まないこと', () => {
    const text = summarizeStall({ state, staleMs: 45 * 60_000, cause, verbosity: 'concise' });
    expect(text).toContain('45分間停滞');
    expect(text).toContain('長時間停滞しているタスク');
    expect(text).not.toContain('中断されたまま');
  });

  it('standard は cause を含むこと', () => {
    const text = summarizeStall({ state, staleMs: 45 * 60_000, cause, verbosity: 'standard' });
    expect(text).toContain('中断されたまま');
  });

  it('detailed は セッション状態と最終遷移を含み、3段階で文長が単調増加すること', () => {
    const lengths = (['concise', 'standard', 'detailed'] as StallVerbosity[]).map(
      (verbosity) => summarizeStall({ state, staleMs: 45 * 60_000, cause, verbosity }).length,
    );
    expect(lengths[0]).toBeLessThan(lengths[1]);
    expect(lengths[1]).toBeLessThan(lengths[2]);
    const detailed = summarizeStall({ state, staleMs: 45 * 60_000, cause, verbosity: 'detailed' });
    expect(detailed).toContain('interrupted');
    expect(detailed).toContain('auto_advance');
  });

  it('空タイムライン・タイトル超長でも壊れないこと', () => {
    const empty = makeState({ title: 'x'.repeat(120) });
    const text = summarizeStall({
      state: empty,
      staleMs: 30 * 60_000,
      cause: '原因不明',
      verbosity: 'detailed',
    });
    expect(text).toContain('…');
    expect(text).toContain('30分間停滞');
  });

  it('1分未満の停滞は最低1分として読み上げること', () => {
    const text = summarizeStall({ state, staleMs: 10_000, cause, verbosity: 'concise' });
    expect(text).toContain('1分間停滞');
  });
});
