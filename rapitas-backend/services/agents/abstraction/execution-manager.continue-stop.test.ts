/**
 * execution-manager.continue-stop.test
 *
 * Unit tests for AgentExecutionManager.continueExecution, stopExecution, and
 * stopAllExecutions: not-found/state guards, continuation-context wiring, and
 * error handling (including that stopAllExecutions tolerates a failing stop()).
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { AgentExecutionManager } from './execution-manager';
import { AgentRegistry } from './registry';
import type { AgentExecutionContext, AgentExecutionResult } from './types';
import {
  makeContext,
  makeFakeAgent,
  makeResult,
  registerFakeAgent,
} from './execution-manager.test-helpers';

beforeEach(() => {
  AgentRegistry.resetInstance();
});

afterEach(() => {
  AgentRegistry.resetInstance();
});

describe('AgentExecutionManager.continueExecution', () => {
  it('throws when the execution is not found', async () => {
    const manager = new AgentExecutionManager();
    await expect(manager.continueExecution('missing', 'answer')).rejects.toThrow(
      'Execution not found: missing',
    );
  });

  it('throws when the execution is not waiting_for_input', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-cont-1', {
      execute: mock(async () => makeResult({ state: 'completed' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-cont-1',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-cont-1' }),
    );

    await expect(manager.continueExecution('exec-cont-1', 'answer')).rejects.toThrow(
      "Cannot continue execution: state is 'completed', expected 'waiting_for_input'",
    );
  });

  it('continues a waiting execution and updates its state on success', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-cont-2', {
      execute: mock(async () => makeResult({ state: 'waiting_for_input' })),
      continue: mock(async () => makeResult({ state: 'completed', output: 'resumed' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-cont-2',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-cont-2', sessionId: 'sess-2' }),
    );

    const result = await manager.continueExecution('exec-cont-2', 'my answer');

    expect(result.output).toBe('resumed');
    expect(manager.getExecutionStatus('exec-cont-2')).toBe('completed');
    expect(agent.continue).toHaveBeenCalledTimes(1);

    const [continuation, newContext] = agent.continue.mock.calls[0] as [
      { sessionId: string; previousExecutionId: string; userResponse: string },
      AgentExecutionContext,
    ];
    expect(continuation.sessionId).toBe('sess-2');
    expect(continuation.previousExecutionId).toBe('exec-cont-2');
    expect(continuation.userResponse).toBe('my answer');
    expect(newContext.parentExecutionId).toBe('exec-cont-2');
    expect(newContext.executionId).not.toBe('exec-cont-2');
  });

  it('falls back to the executionId as sessionId when context.sessionId is unset', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-cont-3', {
      execute: mock(async () => makeResult({ state: 'waiting_for_input' })),
      continue: mock(async () => makeResult({ state: 'completed' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-cont-3',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-cont-3' }),
    );
    await manager.continueExecution('exec-cont-3', 'answer');

    const [continuation] = agent.continue.mock.calls[0] as [{ sessionId: string }];
    expect(continuation.sessionId).toBe('exec-cont-3');
  });

  it('sets state to failed and rethrows on continue() rejection', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-cont-err', {
      execute: mock(async () => makeResult({ state: 'waiting_for_input' })),
      continue: mock(async () => {
        throw new Error('continue-boom');
      }),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-cont-err',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-cont-err' }),
    );

    await expect(manager.continueExecution('exec-cont-err', 'answer')).rejects.toThrow(
      'continue-boom',
    );
    expect(manager.getExecutionStatus('exec-cont-err')).toBe('failed');
  });
});

describe('AgentExecutionManager.stopExecution', () => {
  it('throws when the execution is not found', async () => {
    const manager = new AgentExecutionManager();
    await expect(manager.stopExecution('missing')).rejects.toThrow('Execution not found: missing');
  });

  it('calls agent.stop() and marks the execution cancelled', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-stop', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
    });
    registerFakeAgent(agent);

    void manager.executeTask(
      'agent-stop',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-stop' }),
    );

    await manager.stopExecution('exec-stop');

    expect(agent.stop).toHaveBeenCalledTimes(1);
    expect(manager.getExecutionStatus('exec-stop')).toBe('cancelled');
  });
});

describe('AgentExecutionManager.stopAllExecutions', () => {
  it('stops every active execution and tolerates individual stop() failures', async () => {
    const manager = new AgentExecutionManager();
    const agentOk = makeFakeAgent('agent-all-1', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
    });
    const agentFails = makeFakeAgent('agent-all-2', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
      stop: mock(async () => {
        throw new Error('stop-failed');
      }),
    });
    registerFakeAgent(agentOk);
    void manager.executeTask(
      'agent-all-1',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-all-1' }),
    );

    AgentRegistry.resetInstance();
    registerFakeAgent(agentFails);
    void manager.executeTask(
      'agent-all-2',
      { id: 2, title: 't' },
      makeContext({ executionId: 'exec-all-2' }),
    );

    await expect(manager.stopAllExecutions()).resolves.toBeUndefined();

    expect(agentOk.stop).toHaveBeenCalledTimes(1);
    expect(agentFails.stop).toHaveBeenCalledTimes(1);
    expect(manager.getExecutionStatus('exec-all-1')).toBe('cancelled');
    // stopExecution rejected before setting state, so exec-all-2 stays whatever it was.
    expect(manager.getExecutionStatus('exec-all-2')).not.toBe('cancelled');
  });

  it('is a no-op when there are no active executions', async () => {
    const manager = new AgentExecutionManager();
    await expect(manager.stopAllExecutions()).resolves.toBeUndefined();
  });
});
