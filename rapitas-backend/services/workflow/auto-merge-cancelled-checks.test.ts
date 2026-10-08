/**
 * auto-merge-cancelled-checks.test
 *
 * Coverage for treating a CANCELLED blocking check as an infrastructure signal
 * rather than a code defect: the pure red-check splitter, run-id extraction
 * from the checks' details URLs, and the bounded `gh run rerun` path with its
 * per-head-SHA budget.
 *
 * Why: evaluateAutoMergeChecks folds bucket 'cancel' into 'fail', so a
 * cancelled workflow sent the task to ci_repair — an implementer asked to fix a
 * diff that was never broken. Observed on task 1145 (2026-10-07): the ubuntu
 * build hung, the run was cancelled, and the task bounced ci_repair attempt=1
 * with cat=CI:Build (ubuntu-latest). Adding timeout-minutes to the hanging jobs
 * makes GitHub itself report `cancelled`, so without this split the timeout fix
 * would manufacture the same false bounce on every hang.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { PrCheck } from './auto-merge-checks';

let execBehavior: (cmd: string) => { stdout: string; stderr: string } | Error = () => ({
  stdout: '',
  stderr: '',
});
const execCalls: string[] = [];

const execMock = mock(
  (
    cmd: string,
    _optsOrCb: unknown,
    cb?: (
      err: (Error & { stdout?: string; stderr?: string }) | null,
      result?: { stdout: string; stderr: string },
    ) => void,
  ) => {
    execCalls.push(cmd);
    const callback = (typeof _optsOrCb === 'function' ? _optsOrCb : cb) as (
      err: (Error & { stdout?: string; stderr?: string }) | null,
      result?: { stdout: string; stderr: string },
    ) => void;
    const result = execBehavior(cmd);
    if (result instanceof Error) {
      callback(result as Error & { stdout?: string; stderr?: string });
    } else {
      callback(null, result);
    }
  },
);

// NOTE: bun's mock.module replaces the whole module record, so every export the
// module under test (or its imports) may touch has to be mirrored here.
mock.module('node:child_process', () => ({ exec: execMock, execFile: execMock }));
mock.module('child_process', () => ({ exec: execMock, execFile: execMock }));

// Transitions recorded by the module under test.
const recorded: Array<{ cause?: string; metadata?: Record<string, unknown> }> = [];
mock.module('./transition-recorder', () => ({
  recordTransition: mock(async (t: { cause?: string; metadata?: Record<string, unknown> }) => {
    recorded.push(t);
  }),
}));

const notifications: Array<{ type: string }> = [];
mock.module('./auto-merge-notify', () => ({
  notify: mock(async (n: { type: string }) => {
    notifications.push(n);
  }),
}));

// Prior transition rows the budget check reads.
let priorRows: Array<{ metadata: string | null }> = [];
mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: {
      findMany: mock(async () => priorRows),
    },
  },
}));

mock.module('./auto-merge-checks', () => ({
  ghPath: () => 'gh',
  readHeadSha: mock(async () => 'deadbeef'),
}));

const {
  splitRedChecks,
  rerunRunIdsFromChecks,
  handleCancelledChecks,
  CANCELLED_RERUN_CAUSE,
  MAX_CANCELLED_RERUNS,
} = await import('./auto-merge-cancelled-checks');

const BLOCKING = new Set(['Build (ubuntu-latest)', 'Lint Code', 'Test Backend']);

function check(name: string, bucket: string, link?: string): PrCheck {
  return { name, bucket, link };
}

const candidate = {
  taskId: 1145,
  prNumber: 848,
  cwd: 'C:/Projects/rapitas',
  baseBranch: 'develop',
} as unknown as Parameters<typeof handleCancelledChecks>[0];

beforeEach(() => {
  execCalls.length = 0;
  recorded.length = 0;
  notifications.length = 0;
  priorRows = [];
  execBehavior = () => ({ stdout: '', stderr: '' });
});

describe('splitRedChecks', () => {
  it('separates cancelled from genuinely failed, ignoring non-blocking checks', () => {
    const { failed, cancelled } = splitRedChecks(
      [
        check('Build (ubuntu-latest)', 'cancel'),
        check('Lint Code', 'fail'),
        check('Test Backend', 'pass'),
        check('Full Suite (Advisory)', 'fail'), // not blocking
      ],
      BLOCKING,
    );
    expect(failed.map((c) => c.name)).toEqual(['Lint Code']);
    expect(cancelled.map((c) => c.name)).toEqual(['Build (ubuntu-latest)']);
  });

  it('reports an all-cancelled PR as having no genuine failures', () => {
    const { failed, cancelled } = splitRedChecks(
      [check('Build (ubuntu-latest)', 'cancel'), check('Lint Code', 'cancel')],
      BLOCKING,
    );
    expect(failed).toEqual([]);
    expect(cancelled).toHaveLength(2);
  });
});

describe('rerunRunIdsFromChecks', () => {
  it('extracts distinct run ids and skips links that are not Actions runs', () => {
    const ids = rerunRunIdsFromChecks([
      check('a', 'cancel', 'https://github.com/o/r/actions/runs/111/job/222'),
      // Same run, different job — one rerun covers both.
      check('b', 'cancel', 'https://github.com/o/r/actions/runs/111/job/333'),
      check('c', 'cancel', 'https://github.com/o/r/actions/runs/444/job/555'),
      check('d', 'cancel', 'https://external-ci.example/build/9'),
      check('e', 'cancel'),
    ]);
    expect(ids).toEqual(['111', '444']);
  });
});

describe('handleCancelledChecks', () => {
  it('reruns the failed jobs of each cancelled run and reports handled', async () => {
    const handled = await handleCancelledChecks(candidate, [
      check('Build (ubuntu-latest)', 'cancel', 'https://github.com/o/r/actions/runs/777/job/1'),
    ]);
    expect(handled).toBe(true);
    expect(execCalls.some((c) => c.includes('run rerun 777') && c.includes('--failed'))).toBe(true);
    expect(recorded.some((t) => t.cause === CANCELLED_RERUN_CAUSE)).toBe(true);
    // No ci_repair bounce notification — this is not a code failure.
    expect(notifications.every((n) => n.type !== 'auto_merge_ci_repair')).toBe(true);
  });

  it('records the head SHA so the budget is per-push, not per-task', async () => {
    await handleCancelledChecks(candidate, [
      check('Build (ubuntu-latest)', 'cancel', 'https://github.com/o/r/actions/runs/777/job/1'),
    ]);
    expect(recorded[0]?.metadata?.headSha).toBe('deadbeef');
  });

  it('falls through once the rerun budget for this head SHA is spent', async () => {
    priorRows = Array.from({ length: MAX_CANCELLED_RERUNS }, () => ({
      metadata: JSON.stringify({ headSha: 'deadbeef' }),
    }));
    const handled = await handleCancelledChecks(candidate, [
      check('Build (ubuntu-latest)', 'cancel', 'https://github.com/o/r/actions/runs/777/job/1'),
    ]);
    expect(handled).toBe(false);
    expect(execCalls).toEqual([]);
  });

  it('ignores a spent budget recorded against a different head SHA', async () => {
    priorRows = Array.from({ length: MAX_CANCELLED_RERUNS }, () => ({
      metadata: JSON.stringify({ headSha: 'oldsha' }),
    }));
    const handled = await handleCancelledChecks(candidate, [
      check('Build (ubuntu-latest)', 'cancel', 'https://github.com/o/r/actions/runs/777/job/1'),
    ]);
    expect(handled).toBe(true);
  });

  it('falls through when no run id can be extracted — nothing to rerun', async () => {
    const handled = await handleCancelledChecks(candidate, [
      check('External Check', 'cancel', 'https://external-ci.example/build/9'),
    ]);
    expect(handled).toBe(false);
    expect(execCalls).toEqual([]);
  });

  it('falls through when gh refuses the rerun rather than claiming it handled it', async () => {
    execBehavior = () => new Error('gh: run 777 cannot be rerun');
    const handled = await handleCancelledChecks(candidate, [
      check('Build (ubuntu-latest)', 'cancel', 'https://github.com/o/r/actions/runs/777/job/1'),
    ]);
    expect(handled).toBe(false);
  });
});
