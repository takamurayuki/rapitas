/**
 * subtask-split-policy テスト
 *
 * RAPITAS_ENABLE_SUBTASK_SPLIT の判定パターンと、フラグ状態に応じた
 * planner 向け分割可否指示（buildSubtaskSplitDirective）の出し分けを検証。
 */
import { describe, test, expect, beforeEach, afterAll } from 'bun:test';
import { isSubtaskSplitEnabled, buildSubtaskSplitDirective } from './subtask-split-policy';

const ORIGINAL_ENV = process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;

beforeEach(() => {
  delete process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;
});

afterAll(() => {
  // Restore whatever the process started with so later test files see it.
  if (ORIGINAL_ENV === undefined) {
    delete process.env.RAPITAS_ENABLE_SUBTASK_SPLIT;
  } else {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = ORIGINAL_ENV;
  }
});

describe('isSubtaskSplitEnabled', () => {
  test('未設定なら false（既定は無効）', () => {
    expect(isSubtaskSplitEnabled()).toBe(false);
  });

  test.each(['1', 'true', 'yes', 'on', 'TRUE', 'On', ' yes '])('有効値 %j で true', (value) => {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = value;
    expect(isSubtaskSplitEnabled()).toBe(true);
  });

  test.each(['', '0', 'false', 'no', 'off', 'enabled', '2'])('無効値 %j で false', (value) => {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = value;
    expect(isSubtaskSplitEnabled()).toBe(false);
  });
});

describe('buildSubtaskSplitDirective', () => {
  test('フラグ無効時（既定）は日本語の禁止指示を返す', () => {
    const d = buildSubtaskSplitDirective();
    expect(d).toContain('## サブタスク分割の禁止');
    expect(d).toContain('POST /tasks による子タスク起票');
    expect(d).toContain('単一の plan.md');
    expect(d).toContain('RAPITAS_ENABLE_SUBTASK_SPLIT');
  });

  test('フラグ無効時の en 指示は英語で、日本語の見出しを含まない', () => {
    const d = buildSubtaskSplitDirective('en');
    expect(d).toContain('Subtask splitting is FORBIDDEN');
    expect(d).toContain('POST /tasks');
    expect(d).not.toContain('サブタスク分割の禁止');
  });

  test('フラグ有効時は ja/en とも空文字列を返す（現行動作を維持）', () => {
    process.env.RAPITAS_ENABLE_SUBTASK_SPLIT = '1';
    expect(buildSubtaskSplitDirective('ja')).toBe('');
    expect(buildSubtaskSplitDirective('en')).toBe('');
  });
});
