/**
 * prompt-comparison-cell-executor.test
 *
 * Verifies runComparisonCell never touches AgentExecution/Task (no prisma
 * import at all in the module under test), always removes the worktree it
 * created (success/failure/timeout), injects the candidate addendum only for
 * arm='candidate', calls the knowledge lookup only for knowledge='with', and
 * classifies timeouts/worktree failures as infra_failure (no 'timeout'
 * literal exists in FailureCause — see plan.md 完了条件).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));

let createWorktreeMock = mock(async () => '/tmp/shadow-worktree');
let removeWorktreeMock = mock(async () => true);
mock.module('../../agents/orchestrator/git-operations/worktree/worktree-create', () => ({
  createWorktree: (...args: unknown[]) => createWorktreeMock(...args),
}));
mock.module('../../agents/orchestrator/git-operations/worktree/worktree-remove', () => ({
  removeWorktree: (...args: unknown[]) => removeWorktreeMock(...args),
}));

let buildMemoryContextMock = mock(async () => '');
mock.module('../../workflow/workflow-memory-context', () => ({
  buildMemoryContext: (...args: unknown[]) => buildMemoryContextMock(...args),
}));

type ExecuteResult = {
  success: boolean;
  costUsd?: number;
  executionTimeMs?: number;
  errorMessage?: string;
};

let executeMock = mock(
  async (): Promise<ExecuteResult> => ({ success: true, costUsd: 0.42, executionTimeMs: 1234 }),
);
let stopMock = mock(async () => {});
let capturedAgentConfig: Record<string, unknown> | null = null;
let capturedTask: Record<string, unknown> | null = null;

mock.module('../../agents/agent-factory', () => ({
  agentFactory: {
    createAgent: (config: Record<string, unknown>) => {
      capturedAgentConfig = config;
      return {
        execute: (task: Record<string, unknown>) => {
          capturedTask = task;
          return executeMock();
        },
        stop: () => stopMock(),
      };
    },
  },
}));

const { runComparisonCell, PROMPT_COMPARISON_CELL_TIMEOUT_MS } =
  await import('./prompt-comparison-cell-executor');

function baseOptions(overrides: Partial<Parameters<typeof runComparisonCell>[0]> = {}) {
  return {
    evolutionId: 7,
    sampleTaskId: 810,
    arm: 'current' as const,
    knowledge: 'without' as const,
    modelName: 'claude-sonnet-5',
    task: { title: 'サンプルタスク', description: '説明文' },
    candidateAddendum: '## 改善指示\n- 具体的な手順を書く',
    worktreeBaseDir: '/repo',
    repositoryUrl: null,
    executionSeq: 0,
    ...overrides,
  };
}

beforeEach(() => {
  createWorktreeMock = mock(async () => '/tmp/shadow-worktree');
  removeWorktreeMock = mock(async () => true);
  buildMemoryContextMock = mock(async () => '');
  executeMock = mock(
    async (): Promise<ExecuteResult> => ({ success: true, costUsd: 0.42, executionTimeMs: 1234 }),
  );
  stopMock = mock(async () => {});
  capturedAgentConfig = null;
  capturedTask = null;
});

afterEach(() => {
  mock.restore();
});

describe('runComparisonCell — no DB execution row', () => {
  it('never imports prisma/database in the executor module (source-level check)', async () => {
    const src = await Bun.file(
      'services/self-learning/comparison/prompt-comparison-cell-executor.ts',
    ).text();
    expect(src.includes("from '../../../config/database'")).toBe(false);
    expect(src.includes('prisma.')).toBe(false);
  });

  it('returns a ComparisonRun with the sample task id and a synthetic negative executionId', async () => {
    const run = await runComparisonCell(baseOptions());
    expect(run.taskId).toBe(810);
    expect(run.executionId).toBeLessThan(0);
    expect(run.success).toBe(true);
    expect(run.costUsd).toBe(0.42);
    expect(run.failureCause).toBeNull();
  });
});

describe('runComparisonCell — candidate prompt injection', () => {
  it('injects the candidate addendum only for arm=candidate', async () => {
    await runComparisonCell(baseOptions({ arm: 'current' }));
    const currentPrompt = (capturedTask?.optimizedPrompt as string) ?? '';
    expect(currentPrompt.includes('改善指示')).toBe(false);

    await runComparisonCell(baseOptions({ arm: 'candidate' }));
    const candidatePrompt = (capturedTask?.optimizedPrompt as string) ?? '';
    expect(candidatePrompt.includes('改善指示')).toBe(true);
    expect(candidatePrompt).not.toBe(currentPrompt);
  });
});

describe('runComparisonCell — knowledge toggle', () => {
  it('calls buildMemoryContext once for knowledge=with and zero times for knowledge=without', async () => {
    await runComparisonCell(baseOptions({ knowledge: 'without' }));
    expect(buildMemoryContextMock).toHaveBeenCalledTimes(0);

    await runComparisonCell(baseOptions({ knowledge: 'with' }));
    expect(buildMemoryContextMock).toHaveBeenCalledTimes(1);
  });

  it('appends the knowledge section to the prompt only when knowledge=with', async () => {
    buildMemoryContextMock = mock(async () => '## 記憶\n過去の教訓');
    const withoutRun = await runComparisonCell(baseOptions({ knowledge: 'without' }));
    void withoutRun;
    const withoutPrompt = (capturedTask?.optimizedPrompt as string) ?? '';
    expect(withoutPrompt.includes('過去の教訓')).toBe(false);

    await runComparisonCell(baseOptions({ knowledge: 'with' }));
    const withPrompt = (capturedTask?.optimizedPrompt as string) ?? '';
    expect(withPrompt.includes('過去の教訓')).toBe(true);
  });
});

describe('runComparisonCell — worktree lifecycle', () => {
  it('removes the worktree after a successful run', async () => {
    await runComparisonCell(baseOptions());
    expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
  });

  it('removes the worktree after a failed agent execution', async () => {
    executeMock = mock(async () => ({ success: false, errorMessage: 'boom' }));
    const run = await runComparisonCell(baseOptions());
    expect(run.success).toBe(false);
    expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
  });

  it('does not attempt removal when worktree creation itself failed', async () => {
    createWorktreeMock = mock(async () => {
      throw new Error('git worktree add failed');
    });
    const run = await runComparisonCell(baseOptions());
    expect(run.success).toBe(false);
    expect(run.failureCause).toBe('infra_failure');
    expect(removeWorktreeMock).toHaveBeenCalledTimes(0);
  });

  it('passes the working directory returned by createWorktree to the agent config', async () => {
    createWorktreeMock = mock(async () => '/tmp/shadow-xyz');
    await runComparisonCell(baseOptions());
    expect(capturedAgentConfig?.workingDirectory).toBe('/tmp/shadow-xyz');
  });
});

describe('runComparisonCell — timeout', () => {
  it('classifies a timed-out execution as infra_failure and stops the agent', async () => {
    executeMock = mock(() => new Promise<ExecuteResult>(() => {}));
    const run = await runComparisonCell(baseOptions({ timeoutMs: 20 }));
    expect(run.success).toBe(false);
    expect(run.failureCause).toBe('infra_failure');
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(removeWorktreeMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to the 600s cell timeout constant', () => {
    expect(PROMPT_COMPARISON_CELL_TIMEOUT_MS).toBe(600_000);
  });
});
