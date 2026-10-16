/**
 * execution-manager.queries.test
 *
 * Unit tests for AgentExecutionManager's read-only queries (status lookups,
 * active-execution listing, per-agent listing), cleanupOldExecutions age
 * filtering, and the getDefaultExecutionManager/setDefaultExecutionManager
 * module-level singleton.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import {
  AgentExecutionManager,
  getDefaultExecutionManager,
  setDefaultExecutionManager,
} from './execution-manager';
import { AgentRegistry } from './registry';
import type { AgentExecutionResult } from './types';
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

describe('AgentExecutionManager status queries', () => {
  it('getExecutionStatus returns null for an unknown execution', () => {
    const manager = new AgentExecutionManager();
    expect(manager.getExecutionStatus('nope')).toBeNull();
  });

  it('getExecutionDetails returns null for an unknown execution', () => {
    const manager = new AgentExecutionManager();
    expect(manager.getExecutionDetails('nope')).toBeNull();
  });

  it('getActiveExecutions filters to active states only', async () => {
    const manager = new AgentExecutionManager();
    const running = makeFakeAgent('agent-active', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
    });
    registerFakeAgent(running);
    void manager.executeTask(
      'agent-active',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-active' }),
    );

    AgentRegistry.resetInstance();
    const finished = makeFakeAgent('agent-done', {
      execute: mock(async () => makeResult({ state: 'completed' })),
    });
    registerFakeAgent(finished);
    await manager.executeTask(
      'agent-done',
      { id: 2, title: 't' },
      makeContext({ executionId: 'exec-done' }),
    );

    const active = manager.getActiveExecutions();
    const ids = active.map((e) => e.executionId);
    expect(ids).toContain('exec-active');
    expect(ids).not.toContain('exec-done');
  });

  it('getActiveExecutionCount reflects only active-state executions', async () => {
    const manager = new AgentExecutionManager();
    expect(manager.getActiveExecutionCount()).toBe(0);

    const running = makeFakeAgent('agent-count', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
    });
    registerFakeAgent(running);
    void manager.executeTask('agent-count', { id: 1, title: 't' }, makeContext());

    expect(manager.getActiveExecutionCount()).toBe(1);
  });

  it('getExecutionsByAgent returns [] for an agent with no executions', () => {
    const manager = new AgentExecutionManager();
    expect(manager.getExecutionsByAgent('unknown-agent')).toEqual([]);
  });

  it('getExecutionsByAgent lists all executions for a given agent', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-multi', {
      execute: mock(async () => makeResult({ state: 'waiting_for_input' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-multi',
      { id: 1, title: 't1' },
      makeContext({ executionId: 'exec-multi-1' }),
    );
    await manager.executeTask(
      'agent-multi',
      { id: 2, title: 't2' },
      makeContext({ executionId: 'exec-multi-2' }),
    );

    const list = manager.getExecutionsByAgent('agent-multi');
    expect(list.map((e) => e.executionId).sort()).toEqual(['exec-multi-1', 'exec-multi-2']);
  });
});

describe('AgentExecutionManager.cleanupOldExecutions', () => {
  it('removes completed executions older than maxAgeMs and reports the count', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-old', {
      execute: mock(async () => makeResult({ state: 'completed' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-old',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-old' }),
    );

    const info = manager.getExecutionDetails('exec-old');
    expect(info).not.toBeNull();
    // Backdate startTime directly on the tracked record to simulate age
    // without waiting on the real clock or the 60s post-completion timer.
    info!.startTime = new Date(Date.now() - 2 * 3600000);

    const cleaned = manager.cleanupOldExecutions(3600000);

    expect(cleaned).toBe(1);
    expect(manager.getExecutionDetails('exec-old')).toBeNull();
  });

  it('leaves recent completed executions untouched', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-recent', {
      execute: mock(async () => makeResult({ state: 'completed' })),
    });
    registerFakeAgent(agent);

    await manager.executeTask(
      'agent-recent',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-recent' }),
    );

    const cleaned = manager.cleanupOldExecutions(3600000);

    expect(cleaned).toBe(0);
    expect(manager.getExecutionDetails('exec-recent')).not.toBeNull();
  });

  it('never cleans up a non-terminal (active) execution regardless of age', () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-active-old', {
      execute: mock(() => new Promise<AgentExecutionResult>(() => {})),
    });
    registerFakeAgent(agent);
    void manager.executeTask(
      'agent-active-old',
      { id: 1, title: 't' },
      makeContext({ executionId: 'exec-active-old' }),
    );

    const info = manager.getExecutionDetails('exec-active-old');
    info!.startTime = new Date(Date.now() - 999 * 3600000);

    const cleaned = manager.cleanupOldExecutions(3600000);

    expect(cleaned).toBe(0);
    expect(manager.getExecutionDetails('exec-active-old')).not.toBeNull();
  });

  it('uses the 1-hour default maxAgeMs when not provided', async () => {
    const manager = new AgentExecutionManager();
    const agent = makeFakeAgent('agent-default-age', {
      execute: mock(async () => makeResult({ state: 'failed' })),
    });
    registerFakeAgent(agent);

    await expect(
      manager.executeTask(
        'agent-default-age',
        { id: 1, title: 't' },
        makeContext({ executionId: 'exec-default-age' }),
      ),
    ).resolves.toBeDefined();

    const info = manager.getExecutionDetails('exec-default-age');
    info!.startTime = new Date(Date.now() - 2 * 3600000);

    expect(manager.cleanupOldExecutions()).toBe(1);
  });
});

describe('getDefaultExecutionManager / setDefaultExecutionManager', () => {
  it('returns the same instance across repeated calls', () => {
    const first = getDefaultExecutionManager();
    const second = getDefaultExecutionManager();
    expect(second).toBe(first);
  });

  it('setDefaultExecutionManager overrides the singleton returned afterwards', () => {
    const custom = new AgentExecutionManager({ maxConcurrentExecutions: 42 });
    setDefaultExecutionManager(custom);
    expect(getDefaultExecutionManager()).toBe(custom);
  });
});
