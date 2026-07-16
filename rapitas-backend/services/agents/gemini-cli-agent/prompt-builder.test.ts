/**
 * gemini-cli-agent/prompt-builder ユニットテスト
 *
 * buildStructuredPrompt のフォールバック連鎖、複雑度/優先度ラベル変換、
 * サブタスクの order 順ソートと依存関係表示を検証する。
 * NOTE: codex-cli-agent/prompt-builder.ts とほぼ同一ロジックの別実装
 * （エージェント種別ごとに複製されている）。
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
    const task = makeTask({ analysisInfo: makeAnalysis({ complexity: 'simple' }) });
    expect(buildStructuredPrompt(task, '[test]')).toContain('**複雑度:** シンプル');
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

  test('renders dependency titles resolved from other subtasks, with orphan fallback', () => {
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
            dependencies: [1, 99],
          },
        ],
      }),
    });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).toContain('1. Base, ステップ99 の完了後に実行');
  });

  test('includes reasoning and tips sections when present', () => {
    const task = makeTask({
      analysisInfo: makeAnalysis({ reasoning: 'because X', tips: ['tip A'] }),
    });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).toContain('## 実装方針の根拠');
    expect(result).toContain('because X');
    expect(result).toContain('## 実装のヒント');
    expect(result).toContain('- tip A');
  });

  test('omits subtasks/reasoning/tips sections when absent, still ends with 実行指示', () => {
    const task = makeTask({ analysisInfo: makeAnalysis({ reasoning: '' }) });
    const result = buildStructuredPrompt(task, '[test]');
    expect(result).not.toContain('実装手順');
    expect(result).not.toContain('実装方針の根拠');
    expect(result).not.toContain('実装のヒント');
    expect(result).toContain('## 実行指示');
  });
});
