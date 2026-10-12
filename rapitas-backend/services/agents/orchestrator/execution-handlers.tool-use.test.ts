/**
 * execution-handlers — setupOutputHandler wires the agent's tool_use stream
 * to the plan-deviation operation store under the execution's ID (task 1218).
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const recordToolUse = mock((..._args: unknown[]) => 1);
mock.module('../../workflow/plan-deviation/operation-store', () => ({
  getOperationStore: () => ({ recordToolUse }),
}));

const { setupOutputHandler } = await import('./execution-handlers');
import type { AgentToolUseHandler, BaseAgent } from '../base-agent';
import type { OutputHandlerContext } from './execution-helpers-types';
import type { LogChunkManager } from './log-chunk-manager';

describe('setupOutputHandler — tool_use recorder', () => {
  test('records each tool call with executionId and the last queued log sequence', () => {
    let toolHandler: AgentToolUseHandler | undefined;
    const agent = {
      setOutputHandler: () => {},
      setToolUseHandler: (h: AgentToolUseHandler) => {
        toolHandler = h;
      },
    } as unknown as BaseAgent;
    const ctx = { executionId: 77, taskId: 1 } as unknown as OutputHandlerContext;
    const logManager = {
      addChunk: () => {},
      registerCleanup: () => {},
      lastQueuedSequence: () => 31,
    } as unknown as LogChunkManager;

    setupOutputHandler(agent, ctx, logManager);
    expect(toolHandler).toBeDefined();
    toolHandler!('Bash', { command: 'git status' });
    expect(recordToolUse).toHaveBeenCalledWith(77, 'Bash', { command: 'git status' }, 31);
  });

  test('a recorder failure is swallowed', () => {
    recordToolUse.mockImplementationOnce(() => {
      throw new Error('EACCES');
    });
    let toolHandler: AgentToolUseHandler | undefined;
    const agent = {
      setOutputHandler: () => {},
      setToolUseHandler: (h: AgentToolUseHandler) => {
        toolHandler = h;
      },
    } as unknown as BaseAgent;
    setupOutputHandler(
      agent,
      { executionId: 1 } as unknown as OutputHandlerContext,
      { addChunk: () => {}, registerCleanup: () => {}, lastQueuedSequence: () => 0 } as unknown as LogChunkManager,
    );
    expect(() => toolHandler!('Write', { file_path: 'a' })).not.toThrow();
  });
});
