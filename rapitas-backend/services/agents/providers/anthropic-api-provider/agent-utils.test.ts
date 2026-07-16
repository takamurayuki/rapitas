/**
 * anthropic-api-provider/agent-utils ユニットテスト
 *
 * buildPrompt のフォールバック連鎖、getDefaultSystemPrompt の作業ディレクトリ
 * 埋め込み、mapApiError のステータスコード別マッピングを検証する。
 */
import { describe, test, expect } from 'bun:test';
import { buildPrompt, getDefaultSystemPrompt, mapApiError } from './agent-utils';
import type { AgentExecutionContext, AgentTaskDefinition } from '../../abstraction/types';
import { APIError } from '@anthropic-ai/sdk';

function makeTask(overrides: Partial<AgentTaskDefinition> = {}): AgentTaskDefinition {
  return { title: 'Do the thing', ...overrides } as AgentTaskDefinition;
}

/** Builds a minimal object matching the fields mapApiError actually reads. */
function makeApiError(
  status: number,
  message: string,
  headers?: Record<string, string>,
): InstanceType<typeof APIError> {
  return {
    status,
    message,
    headers: headers ? new Headers(headers) : undefined,
  } as unknown as InstanceType<typeof APIError>;
}

describe('buildPrompt', () => {
  test('prefers optimizedPrompt when present', () => {
    const task = makeTask({ optimizedPrompt: 'optimized', prompt: 'raw' });
    expect(buildPrompt(task)).toBe('optimized');
  });

  test('falls back to prompt when optimizedPrompt is absent', () => {
    const task = makeTask({ prompt: 'raw prompt' });
    expect(buildPrompt(task)).toBe('raw prompt');
  });

  test('builds a title-only prompt when neither prompt field is set', () => {
    const task = makeTask({ title: 'Fix the bug' });
    expect(buildPrompt(task)).toBe('# Task: Fix the bug');
  });

  test('includes the description section when present', () => {
    const task = makeTask({ title: 'T', description: 'Some details' });
    const result = buildPrompt(task);
    expect(result).toContain('## Description');
    expect(result).toContain('Some details');
  });

  test('includes analysis complexity and summary', () => {
    const task = makeTask({
      title: 'T',
      analysis: { complexity: 'high', summary: 'a big task' } as never,
    });
    const result = buildPrompt(task);
    expect(result).toContain('## Analysis');
    expect(result).toContain('- Complexity: high');
    expect(result).toContain('- Summary: a big task');
  });

  test('includes subtasks ordered under an Analysis section', () => {
    const task = makeTask({
      title: 'T',
      analysis: {
        complexity: 'medium',
        summary: 's',
        subtasks: [
          { order: 1, title: 'Step one', description: 'first' },
          { order: 2, title: 'Step two', description: 'second' },
        ],
      } as never,
    });
    const result = buildPrompt(task);
    expect(result).toContain('## Subtasks');
    expect(result).toContain('1. Step one: first');
    expect(result).toContain('2. Step two: second');
  });

  test('omits the Subtasks section when subtasks is empty', () => {
    const task = makeTask({
      title: 'T',
      analysis: { complexity: 'low', summary: 's', subtasks: [] } as never,
    });
    expect(buildPrompt(task)).not.toContain('## Subtasks');
  });
});

describe('getDefaultSystemPrompt', () => {
  test('embeds the working directory', () => {
    const ctx = { workingDirectory: '/repo/project' } as AgentExecutionContext;
    const prompt = getDefaultSystemPrompt(ctx);
    expect(prompt).toContain('/repo/project');
    expect(prompt).toContain('software development');
  });
});

describe('mapApiError', () => {
  test('maps 401 to a non-recoverable authentication error', () => {
    const err = mapApiError(makeApiError(401, 'bad key'));
    expect(err.type).toBe('authentication');
    expect(err.recoverable).toBe(false);
    expect(err.message).toContain('bad key');
  });

  test('maps 429 to a recoverable rate_limit error using the retry-after header', () => {
    const err = mapApiError(makeApiError(429, 'slow down', { 'retry-after': '30' }));
    expect(err.type).toBe('rate_limit');
    expect(err.recoverable).toBe(true);
    expect(err.retryAfter).toBe(30_000);
  });

  test('defaults retry-after to 60s when the header is missing', () => {
    const err = mapApiError(makeApiError(429, 'slow down'));
    expect(err.retryAfter).toBe(60_000);
  });

  test('maps 500/502/503 to a recoverable network error with a 5s retry', () => {
    for (const status of [500, 502, 503]) {
      const err = mapApiError(makeApiError(status, 'server error'));
      expect(err.type).toBe('network');
      expect(err.recoverable).toBe(true);
      expect(err.retryAfter).toBe(5000);
    }
  });

  test('maps 400 to a non-recoverable validation error', () => {
    const err = mapApiError(makeApiError(400, 'bad input'));
    expect(err.type).toBe('validation');
    expect(err.recoverable).toBe(false);
  });

  test('maps an unrecognized status to a non-recoverable execution error', () => {
    const err = mapApiError(makeApiError(418, "I'm a teapot"));
    expect(err.type).toBe('execution');
    expect(err.recoverable).toBe(false);
  });
});
