/**
 * workflow-log-context.test
 *
 * Unit tests for workflowLogCtx() — the pino baggage builder. Focus: which
 * values get dropped (undefined/null) vs kept (falsy-but-defined like 0 or '').
 */
import { describe, it, expect } from 'bun:test';
import { workflowLogCtx } from './workflow-log-context';

describe('workflowLogCtx', () => {
  it('returns an empty object for an empty input', () => {
    expect(workflowLogCtx({})).toEqual({});
  });

  it('includes all provided fields', () => {
    const ctx = workflowLogCtx({
      taskId: 1,
      executionId: 2,
      sessionId: 3,
      role: 'planner',
      phase: 'plan',
      agentType: 'claude',
      workflowStatus: 'in_progress',
    });
    expect(ctx).toEqual({
      taskId: 1,
      executionId: 2,
      sessionId: 3,
      role: 'planner',
      phase: 'plan',
      agentType: 'claude',
      workflowStatus: 'in_progress',
    });
  });

  it('drops undefined fields', () => {
    const ctx = workflowLogCtx({ taskId: 1, executionId: undefined });
    expect(ctx).toEqual({ taskId: 1 });
    expect('executionId' in ctx).toBe(false);
  });

  it('drops null fields', () => {
    const ctx = workflowLogCtx({ taskId: 1, sessionId: null, role: null });
    expect(ctx).toEqual({ taskId: 1 });
  });

  it('keeps a falsy-but-defined numeric 0', () => {
    const ctx = workflowLogCtx({ taskId: 0, executionId: 0 });
    expect(ctx).toEqual({ taskId: 0, executionId: 0 });
  });

  it('keeps a falsy-but-defined empty string', () => {
    const ctx = workflowLogCtx({ role: '', phase: '' });
    expect(ctx).toEqual({ role: '', phase: '' });
  });

  it('mixes kept and dropped fields correctly', () => {
    const ctx = workflowLogCtx({
      taskId: 5,
      executionId: null,
      sessionId: undefined,
      role: 'verifier',
    });
    expect(ctx).toEqual({ taskId: 5, role: 'verifier' });
  });
});
