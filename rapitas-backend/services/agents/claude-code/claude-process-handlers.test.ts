/**
 * claude-process-handlers.test
 *
 * Task 1582: when the CLI exits while self-verification is still running,
 * the execution must not resolve (and the screen must not show 「実行完了」)
 * until the verdict is out. The result line has to be emitted before the
 * resolve, and a stop request during the wait resolves as cancelled.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { AgentExecutionResult, AgentStatus } from '../base-agent';
import { createCloseHandler, type ProcessHandlerAgent } from './claude-process-handlers';
import {
  createSelfVerificationReporter,
  type ActivityStore,
  type SelfVerificationActivity,
} from '../../workflow/self-verification-activity';

const WT = 'C:/x/.worktrees/task-1582';
let records: SelfVerificationActivity[];
const store: ActivityStore = {
  markStarted: () => {},
  markFinished: () => {},
  listForWorktree: () => records,
  listForTask: () => records,
  isRunning: (r) => r.state === 'running',
  isActiveForWorktree: () => records.some((r) => r.state === 'running'),
};

function running(): SelfVerificationActivity {
  return {
    runId: 'r1',
    taskId: 1582,
    worktreeKey: WT.toLowerCase(),
    worktreePath: WT,
    ownerPid: 1,
    startedAt: 5_000,
    updatedAt: 5_000,
    state: 'running',
  };
}

function setup(opts: { onSleep?: (n: number) => void; status?: AgentStatus } = {}) {
  const events: string[] = [];
  let status: AgentStatus = opts.status ?? 'running';
  const agent: ProcessHandlerAgent = {
    process: null,
    lineBuffer: '',
    outputBuffer: 'body',
    errorBuffer: '',
    logPrefix: '[t]',
    parserWorker: null,
    workerArtifacts: [],
    workerCommits: [],
    onParseComplete: null,
    getStatus: () => status,
    setStatusInternal: (s) => {
      status = s;
    },
    emitOutputInternal: (text) => {
      if (text.startsWith('[SelfVerification]')) events.push(text.trim().split(' ')[1]);
    },
  };
  let sleeps = 0;
  const reporter = createSelfVerificationReporter({
    workDir: WT,
    executionStartedAt: 5_000,
    emit: (l) => agent.emitOutputInternal(l),
    store,
    sleep: async () => {
      sleeps += 1;
      opts.onSleep?.(sleeps);
    },
  });
  const results: AgentExecutionResult[] = [];
  const handler = createCloseHandler({
    agent,
    workDir: WT,
    startTime: 0,
    resolve: (r) => {
      events.push('resolve');
      results.push(r);
    },
    buildResolveAfterParse: (_code, _wd, _st, resolve) => () => {
      events.push('resolveAfterParse');
      resolve({ success: true, output: agent.outputBuffer, executionTimeMs: 1 });
    },
    monitor: { cleanup: () => {} },
    cleanupPromptFile: () => {},
    reporter,
  });
  return {
    events,
    results,
    handler,
    cancel: () => {
      status = 'cancelled';
    },
    sleeps: () => sleeps,
  };
}

beforeEach(() => {
  records = [];
});

describe('createCloseHandler — waits for self-verification (task 1582)', () => {
  test('resolves only after the self-verification result line', async () => {
    records = [running()];
    const h = setup({
      onSleep: (n) => {
        if (n === 2)
          records = [{ ...running(), state: 'finished', ok: true, passed: 3, failed: 0 }];
      },
    });
    await h.handler(0);
    expect(h.events).toEqual(['waiting', 'result', 'resolveAfterParse', 'resolve']);
    expect(h.results[0].success).toBe(true);
  });

  test('without a running self-verification it resolves straight away', async () => {
    const h = setup();
    await h.handler(0);
    expect(h.events).toEqual(['resolveAfterParse', 'resolve']);
    expect(h.sleeps()).toBe(0);
  });

  test('a stop request during the wait resolves as cancelled and skips the normal resolve', async () => {
    records = [running()];
    let cancelFn: () => void = () => {};
    const h = setup({ onSleep: (n) => n === 1 && cancelFn() });
    cancelFn = h.cancel;
    await h.handler(0);
    expect(h.events).not.toContain('resolveAfterParse');
    expect(h.results).toHaveLength(1);
    expect(h.results[0].failureType).toBe('cancelled');
  });

  test('an execution already resolved by a timeout is not resolved again', async () => {
    records = [running()];
    const h = setup({ status: 'failed' });
    await h.handler(0);
    expect(h.results).toHaveLength(0);
    expect(h.sleeps()).toBe(0);
  });
});
