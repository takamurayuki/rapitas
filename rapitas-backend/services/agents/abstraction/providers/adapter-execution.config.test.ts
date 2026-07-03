/**
 * adapter-execution.config.test
 *
 * Unit tests for the legacy config/task builders in adapter-execution.ts:
 * buildLegacyConfig, buildContinuationConfig, buildLegacyTask, buildContinuationTask.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildLegacyConfig,
  buildContinuationConfig,
  buildLegacyTask,
  buildContinuationTask,
} from './adapter-execution';
import type {
  AgentExecutionContext,
  AgentTaskDefinition,
  ContinuationContext,
  ClaudeCodeProviderConfig,
} from '../types';

function makeContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return { executionId: 'exec-1', workingDirectory: '/tmp/work', ...overrides };
}

function makeProviderConfig(
  overrides: Partial<ClaudeCodeProviderConfig> = {},
): ClaudeCodeProviderConfig {
  return { providerId: 'claude-code', enabled: true, ...overrides };
}

// ── buildLegacyConfig ──

describe('buildLegacyConfig', () => {
  it('prefers context.timeout over config.defaultTimeout', () => {
    const cfg = buildLegacyConfig(
      makeContext({ timeout: 1000 }),
      makeProviderConfig({ defaultTimeout: 5000 }),
    );
    expect(cfg.timeout).toBe(1000);
  });

  it('falls back to config.defaultTimeout when context.timeout is unset', () => {
    const cfg = buildLegacyConfig(makeContext(), makeProviderConfig({ defaultTimeout: 5000 }));
    expect(cfg.timeout).toBe(5000);
  });

  it('falls back to the hard-coded 900000ms default when nothing is set', () => {
    const cfg = buildLegacyConfig(makeContext(), makeProviderConfig());
    expect(cfg.timeout).toBe(900000);
  });

  it('sets dangerouslySkipPermissions when the context requests it', () => {
    const cfg = buildLegacyConfig(
      makeContext({ dangerouslySkipPermissions: true }),
      makeProviderConfig(),
    );
    expect(cfg.dangerouslySkipPermissions).toBe(true);
  });

  it('sets dangerouslySkipPermissions when the provider config requests it', () => {
    const cfg = buildLegacyConfig(
      makeContext(),
      makeProviderConfig({ dangerouslySkipPermissions: true }),
    );
    expect(cfg.dangerouslySkipPermissions).toBe(true);
  });

  it('leaves dangerouslySkipPermissions falsy when neither source sets it', () => {
    const cfg = buildLegacyConfig(makeContext(), makeProviderConfig());
    expect(cfg.dangerouslySkipPermissions).toBeFalsy();
  });

  it('sets continueConversation and resumeSessionId from context.sessionId', () => {
    const cfg = buildLegacyConfig(makeContext({ sessionId: 'sess-1' }), makeProviderConfig());
    expect(cfg.continueConversation).toBe(true);
    expect(cfg.resumeSessionId).toBe('sess-1');
  });

  it('sets continueConversation=false when context has no sessionId', () => {
    const cfg = buildLegacyConfig(makeContext(), makeProviderConfig());
    expect(cfg.continueConversation).toBe(false);
    expect(cfg.resumeSessionId).toBeUndefined();
  });

  it('carries the workingDirectory through unchanged', () => {
    const cfg = buildLegacyConfig(makeContext({ workingDirectory: '/repo' }), makeProviderConfig());
    expect(cfg.workingDirectory).toBe('/repo');
  });
});

// ── buildContinuationConfig ──

describe('buildContinuationConfig', () => {
  const continuation: ContinuationContext = { sessionId: '', previousExecutionId: 'exec-0' };

  it('always sets continueConversation=true', () => {
    const cfg = buildContinuationConfig(makeContext(), makeProviderConfig(), continuation, null);
    expect(cfg.continueConversation).toBe(true);
  });

  it('prefers continuation.sessionId over the current session id', () => {
    const cfg = buildContinuationConfig(
      makeContext(),
      makeProviderConfig(),
      { ...continuation, sessionId: 'from-continuation' },
      'from-current',
    );
    expect(cfg.resumeSessionId).toBe('from-continuation');
  });

  it('falls back to currentSessionId when continuation.sessionId is empty', () => {
    const cfg = buildContinuationConfig(
      makeContext(),
      makeProviderConfig(),
      continuation,
      'from-current',
    );
    expect(cfg.resumeSessionId).toBe('from-current');
  });

  it('resolves resumeSessionId to undefined when both sources are empty', () => {
    const cfg = buildContinuationConfig(makeContext(), makeProviderConfig(), continuation, null);
    expect(cfg.resumeSessionId).toBeUndefined();
  });

  it('applies the same timeout/skip-permission precedence as buildLegacyConfig', () => {
    const cfg = buildContinuationConfig(
      makeContext({ timeout: 2000, dangerouslySkipPermissions: true }),
      makeProviderConfig({ defaultTimeout: 9000 }),
      continuation,
      null,
    );
    expect(cfg.timeout).toBe(2000);
    expect(cfg.dangerouslySkipPermissions).toBe(true);
  });
});

// ── buildLegacyTask ──

describe('buildLegacyTask', () => {
  it('parses a numeric string id to a number', () => {
    const task = buildLegacyTask({ id: '42', title: 't' } as AgentTaskDefinition, makeContext());
    expect(task.id).toBe(42);
  });

  it('falls back to 0 for a non-numeric string id', () => {
    const task = buildLegacyTask(
      { id: 'not-a-number', title: 't' } as AgentTaskDefinition,
      makeContext(),
    );
    expect(task.id).toBe(0);
  });

  it('passes a numeric id through unchanged', () => {
    const task = buildLegacyTask({ id: 7, title: 't' }, makeContext());
    expect(task.id).toBe(7);
  });

  it('carries title, description, workingDirectory, and optimizedPrompt', () => {
    const task = buildLegacyTask(
      {
        id: 1,
        title: 'My Task',
        description: 'desc',
        optimizedPrompt: 'do the thing',
      },
      makeContext({ workingDirectory: '/repo' }),
    );
    expect(task.title).toBe('My Task');
    expect(task.description).toBe('desc');
    expect(task.workingDirectory).toBe('/repo');
    expect(task.optimizedPrompt).toBe('do the thing');
  });

  it('leaves analysisInfo undefined when the task has no analysis', () => {
    const task = buildLegacyTask({ id: 1, title: 't' }, makeContext());
    expect(task.analysisInfo).toBeUndefined();
  });

  it('maps analysis fields, defaulting missing estimatedDuration to 0 hours', () => {
    const task = buildLegacyTask(
      {
        id: 1,
        title: 't',
        analysis: { summary: 'sum', complexity: 'medium' },
      },
      makeContext(),
    );
    expect(task.analysisInfo?.summary).toBe('sum');
    expect(task.analysisInfo?.complexity).toBe('medium');
    expect(task.analysisInfo?.estimatedTotalHours).toBe(0);
    expect(task.analysisInfo?.subtasks).toEqual([]);
    expect(task.analysisInfo?.tips).toEqual([]);
  });

  it('converts estimatedDuration minutes to hours for the task and its subtasks', () => {
    const task = buildLegacyTask(
      {
        id: 1,
        title: 't',
        analysis: {
          summary: 'sum',
          complexity: 'complex',
          estimatedDuration: 120,
          tips: ['careful'],
          subtasks: [
            {
              order: 1,
              title: 'sub1',
              description: 'd1',
              estimatedDuration: 30,
              priority: 'high',
              dependencies: [2],
            },
            {
              order: 2,
              title: 'sub2',
              description: 'd2',
              priority: 'low',
            },
          ],
        },
      },
      makeContext(),
    );

    expect(task.analysisInfo?.estimatedTotalHours).toBe(2);
    expect(task.analysisInfo?.tips).toEqual(['careful']);
    expect(task.analysisInfo?.subtasks).toHaveLength(2);
    expect(task.analysisInfo?.subtasks[0]).toEqual({
      order: 1,
      title: 'sub1',
      description: 'd1',
      estimatedHours: 0.5,
      priority: 'high',
      dependencies: [2],
    });
    // Subtask with no estimatedDuration defaults to 0 hours.
    expect(task.analysisInfo?.subtasks[1].estimatedHours).toBe(0);
  });
});

// ── buildContinuationTask ──

describe('buildContinuationTask', () => {
  it('sets a fixed title of "User Response"', () => {
    const task = buildContinuationTask({ sessionId: 's', previousExecutionId: '1' }, makeContext());
    expect(task.title).toBe('User Response');
  });

  it('parses a numeric previousExecutionId string into the task id', () => {
    const task = buildContinuationTask(
      { sessionId: 's', previousExecutionId: '99' },
      makeContext(),
    );
    expect(task.id).toBe(99);
  });

  it('falls back to id 0 for a non-numeric previousExecutionId', () => {
    const task = buildContinuationTask(
      { sessionId: 's', previousExecutionId: 'exec-abc' },
      makeContext(),
    );
    expect(task.id).toBe(0);
  });

  it('uses userResponse as the description, defaulting to empty string', () => {
    const withResponse = buildContinuationTask(
      { sessionId: 's', previousExecutionId: '1', userResponse: 'yes please' },
      makeContext(),
    );
    expect(withResponse.description).toBe('yes please');

    const withoutResponse = buildContinuationTask(
      { sessionId: 's', previousExecutionId: '1' },
      makeContext(),
    );
    expect(withoutResponse.description).toBe('');
  });

  it('carries the workingDirectory from the context', () => {
    const task = buildContinuationTask(
      { sessionId: 's', previousExecutionId: '1' },
      makeContext({ workingDirectory: '/repo' }),
    );
    expect(task.workingDirectory).toBe('/repo');
  });
});
