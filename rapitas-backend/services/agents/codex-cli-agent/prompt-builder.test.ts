/**
 * codex-cli-agent/prompt-builder ユニットテスト
 *
 * buildStructuredPrompt のフォールバック連鎖、複雑度/優先度ラベル変換、
 * サブタスクの order 順ソートと依存関係表示を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import type { AgentTask, TaskAnalysisInfo } from '../base-agent';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { buildStructuredPrompt } = await import('./prompt-builder');

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return { id: 1, title: 'Task Title', ...overrides } as AgentTask;
}

function makeAnalysis(overrides: Partial<TaskAnalysisInfo> = {}): TaskAnalysisInfo {
  return {
    summary: 'summary text',
    complexity: 'medium',
    estimatedTotalHours: 3,
    subtasks: [],
    reasoning: 'reasoning text',
    ...overrides,
  };
}

describe('buildStructuredPrompt', () => {
  test('returns optimizedPrompt directly when present', () => {
    const task = makeTask({ optimizedPrompt: 'opt', analysisInfo: makeAnalysis() });
    expect(buildStructuredPrompt(task, '[test]')).toBe('opt');
  });

  test('falls back to description when there is no analysisInfo', () => {
    const task = makeTask({ description: 'desc' });
    expect(buildStructuredPrompt(task, '[test]')).toBe('desc');
  });

  test('falls back to title when neither optimizedPrompt, analysisInfo, nor description is set', () => {
    const task = makeTask({ title: 'just title' });
    expect(buildStructuredPrompt(task, '[test]')).toBe('just title');
  });

  test('translates complexity to its Japanese label', () => {
    const task = makeTask({ analysisInfo: makeAnalysis({ complexity: 'complex' }) });
    expect(buildStructuredPrompt(task, '[test]')).toContain('**複雑度:** 複雑');
  });

  test('falls back to the raw complexity value when unrecognized', () => {
    const task = makeTask({
      analysisInfo: makeAnalysis({ complexity: 'unknown' as never }),
    });
    expect(buildStructuredPrompt(task, '[test]')).toContain('**複雑度:** unknown');
  });

  test('includes the task description section when present alongside analysisInfo', () => {
    const task = makeTask({ description: 'full desc', analysisInfo: makeAnalysis() });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).toContain('## タスク詳細');
    expect(result).toContain('full desc');
  });

  test('sorts subtasks by order regardless of input array order', () => {
    const task = makeTask({
      analysisInfo: makeAnalysis({
        subtasks: [
          { title: 'Second', description: 'd2', estimatedHours: 1, priority: 'low', order: 2 },
          { title: 'First', description: 'd1', estimatedHours: 1, priority: 'high', order: 1 },
        ],
      }),
    });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result.indexOf('### 1. First')).toBeLessThan(result.indexOf('### 2. Second'));
  });

  test('translates subtask priority to its Japanese label', () => {
    const task = makeTask({
      analysisInfo: makeAnalysis({
        subtasks: [
          { title: 'T', description: 'd', estimatedHours: 1, priority: 'urgent', order: 1 },
        ],
      }),
    });
    expect(buildStructuredPrompt(task, '[test]')).toContain('- **優先度:** 緊急');
  });

  test('renders dependency titles resolved from other subtasks', () => {
    const task = makeTask({
      analysisInfo: makeAnalysis({
        subtasks: [
          { title: 'Base', description: 'd', estimatedHours: 1, priority: 'low', order: 1 },
          {
            title: 'Dependent',
            description: 'd',
            estimatedHours: 1,
            priority: 'low',
            order: 2,
            dependencies: [1],
          },
        ],
      }),
    });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).toContain('1. Base の完了後に実行');
  });

  test('falls back to "ステップN" when a dependency order has no matching subtask', () => {
    const task = makeTask({
      analysisInfo: makeAnalysis({
        subtasks: [
          {
            title: 'Orphan',
            description: 'd',
            estimatedHours: 1,
            priority: 'low',
            order: 1,
            dependencies: [99],
          },
        ],
      }),
    });
    expect(buildStructuredPrompt(task, '[test]')).toContain('ステップ99 の完了後に実行');
  });

  test('includes reasoning under 実装方針の根拠', () => {
    const task = makeTask({ analysisInfo: makeAnalysis({ reasoning: 'because X' }) });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).toContain('## 実装方針の根拠');
    expect(result).toContain('because X');
  });

  test('includes tips under 実装のヒント when present', () => {
    const task = makeTask({ analysisInfo: makeAnalysis({ tips: ['tip A', 'tip B'] }) });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).toContain('## 実装のヒント');
    expect(result).toContain('- tip A');
    expect(result).toContain('- tip B');
  });

  test('always ends with the 実行指示 section', () => {
    const task = makeTask({ analysisInfo: makeAnalysis() });
    expect(buildStructuredPrompt(task, '[test]')).toContain('## 実行指示');
  });
});
