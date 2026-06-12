/**
 * isAutoRunHandlingTask テスト
 *
 * 停止ボタン押下時に「テーマの auto-run がそのタスクを実行中か」を判定する純粋関数。
 * 真のときだけ stop-route はテーマの auto-run を停止し、再投入(再実行)を防ぐ。
 */
import { describe, test, expect } from 'bun:test';
import {
  isAutoRunHandlingTask,
  type ThemeAutoRunState,
} from '../../services/workflow/auto-run/theme-auto-run-service';

function state(over: Partial<ThemeAutoRunState>): ThemeAutoRunState {
  return {
    id: 1,
    themeId: 9,
    enabled: true,
    status: 'running',
    order: 'created',
    currentTaskId: 5,
    processedCount: 0,
    lastError: null,
    lastRunAt: null,
    startedAt: null,
    updatedAt: '',
    ...over,
  };
}

describe('isAutoRunHandlingTask', () => {
  test('null 状態なら false', () => {
    expect(isAutoRunHandlingTask(null, 5)).toBe(false);
  });

  test('running かつ currentTaskId 一致なら true', () => {
    expect(isAutoRunHandlingTask(state({ status: 'running', currentTaskId: 5 }), 5)).toBe(true);
  });

  test('paused / stopping でも当該タスクなら true（再開・停止処理中の再投入も防ぐ）', () => {
    expect(isAutoRunHandlingTask(state({ status: 'paused', currentTaskId: 5 }), 5)).toBe(true);
    expect(isAutoRunHandlingTask(state({ status: 'stopping', currentTaskId: 5 }), 5)).toBe(true);
  });

  test('別タスクが currentTaskId のときは false（手動停止に影響しない）', () => {
    expect(isAutoRunHandlingTask(state({ status: 'running', currentTaskId: 7 }), 5)).toBe(false);
  });

  test('idle のときは false（auto-run が動いていない）', () => {
    expect(isAutoRunHandlingTask(state({ status: 'idle', currentTaskId: 5 }), 5)).toBe(false);
  });
});
