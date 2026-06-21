// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * Tests for shutdown error handling in execute-route and continue-post-handler catch blocks.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ---------------------------------------------------------------------------
// Pre-defined mock functions — must be defined before mock.module() calls
// ---------------------------------------------------------------------------

const mockTask = { update: mock(() => Promise.resolve({})) };
const mockAgentSession = { update: mock(() => Promise.resolve({})) };

const mockDb = {
  task: mockTask,
  agentSession: mockAgentSession,
};

const mockLog = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
};

const mockReleaseTaskExecLock = mock(() => {});

// ---------------------------------------------------------------------------
// Module mocks — must be registered before dynamic imports
// ---------------------------------------------------------------------------

mock.module('../../../config/database', () => ({
  prisma: mockDb,
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => mockLog,
}));

mock.module('../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({}) },
}));

mock.module('./session-helpers', () => ({
  updateSessionStatusWithRetry: mock(() => Promise.resolve()),
}));

mock.module('./execution-lock', () => ({
  releaseTaskExecutionLock: mockReleaseTaskExecLock,
  acquireTaskExecutionLock: mock(() => Promise.resolve(true)),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleContinueError — shutdown path', () => {
  let handleContinueError: (error: Error, taskId: number, sessionId: number) => Promise<void>;

  beforeEach(async () => {
    mockTask.update.mockClear();
    mockAgentSession.update.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockReleaseTaskExecLock.mockClear();
    const mod = await import('./continue-post-handler');
    handleContinueError = mod.handleContinueError;
  });

  it('logs WARN (not ERROR) on shutdown error', async () => {
    await handleContinueError(new Error('Manager is shutting down'), 1, 10);
    expect(mockLog.warn).toHaveBeenCalledTimes(1);
    expect(mockLog.error).not.toHaveBeenCalled();
  });

  it('sets session to interrupted on shutdown error', async () => {
    await handleContinueError(new Error('Manager is shutting down'), 1, 10);
    expect(mockAgentSession.update).toHaveBeenCalledTimes(1);
    const callArgs = mockAgentSession.update.mock.calls[0][0];
    expect(callArgs.data.status).toBe('interrupted');
  });

  it('does NOT reset task status to todo on shutdown error', async () => {
    await handleContinueError(new Error('Manager is shutting down'), 1, 10);
    expect(mockTask.update).not.toHaveBeenCalled();
  });

  it('releases execution lock even on shutdown error', async () => {
    await handleContinueError(new Error('Manager is shutting down'), 1, 10);
    expect(mockReleaseTaskExecLock).toHaveBeenCalledWith(1);
  });
});

describe('handleContinueError — normal error path', () => {
  let handleContinueError: (error: Error, taskId: number, sessionId: number) => Promise<void>;

  beforeEach(async () => {
    mockTask.update.mockClear();
    mockAgentSession.update.mockClear();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
    mockReleaseTaskExecLock.mockClear();
    const mod = await import('./continue-post-handler');
    handleContinueError = mod.handleContinueError;
  });

  it('logs ERROR on non-shutdown error', async () => {
    await handleContinueError(new Error('Something went wrong'), 2, 20);
    expect(mockLog.error).toHaveBeenCalledTimes(1);
    expect(mockLog.warn).not.toHaveBeenCalled();
  });

  it('sets session to failed on non-shutdown error', async () => {
    await handleContinueError(new Error('Something went wrong'), 2, 20);
    expect(mockAgentSession.update).toHaveBeenCalledTimes(1);
    const callArgs = mockAgentSession.update.mock.calls[0][0];
    expect(callArgs.data.status).toBe('failed');
  });

  it('resets task status to todo on non-shutdown error', async () => {
    await handleContinueError(new Error('Something went wrong'), 2, 20);
    expect(mockTask.update).toHaveBeenCalledTimes(1);
    const callArgs = mockTask.update.mock.calls[0][0];
    expect(callArgs.data.status).toBe('todo');
  });

  it('releases execution lock on non-shutdown error', async () => {
    await handleContinueError(new Error('Something went wrong'), 2, 20);
    expect(mockReleaseTaskExecLock).toHaveBeenCalledWith(2);
  });
});
