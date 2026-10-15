/**
 * ci-self-repair テスト
 *
 * CI失敗時に実装へ差し戻す自己修復ループ:
 * plan有無での戻し先status、上限到達でbounced:false、再投入(enqueue)、
 * question.md への差し戻しフィードバック記載を検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// Mutable behavior for the mocked exec (gh CLI). Branch on the command string:
// 'pr checks' → check list with links, 'run view' → job log, 'headRefOid' →
// head SHA. NOTE: follows the execBehavior pattern from auto-merge-checks.test —
// the shared tests/helpers/mock-child-process cannot vary responses per call.
type ExecCb = (
  err: (Error & { stdout?: string; stderr?: string }) | null,
  result?: { stdout: string; stderr: string },
) => void;
let execBehavior: (cmd: string) => { stdout: string; stderr: string } | Error = () => ({
  stdout: '[]',
  stderr: '',
});

const execMock = mock((cmd: string, _optsOrCb: unknown, cb?: ExecCb) => {
  // promisify(exec) calls exec(cmd, options, callback).
  const callback = (typeof _optsOrCb === 'function' ? _optsOrCb : cb) as ExecCb;
  const result = execBehavior(cmd);
  if (result instanceof Error) {
    callback(result as Error & { stdout?: string; stderr?: string });
  } else {
    callback(null, result);
  }
});

// NOTE: Mirror ALL child_process exports under both specifiers — bun
// mock.module is process-global; any other file in this test run importing
// child_process/node:child_process would break if exec/execFile is missing.
mock.module('child_process', () => ({ exec: execMock, execFile: mock(() => {}) }));
mock.module('node:child_process', () => ({ exec: execMock, execFile: mock(() => {}) }));

const mockPrisma = {
  workflowTransition: { count: mock(() => Promise.resolve(0)) },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
  task: {
    update: mock(() => Promise.resolve({})),
    // NOTE: Added after ci-self-repair.ts:119 — findUnique checks if task is a
    // conflict-resolution task (title matches "PR #N の競合を解消") to skip CI repair.
    findUnique: mock(() => Promise.resolve(null)),
  },
};
const recordTransition = mock(() => Promise.resolve());
const writeWorkflowFile = mock(() => Promise.resolve('/p/question.md'));
const readWorkflowFile = mock(() => Promise.resolve(''));
const resolveWorkflowDir = mock(() => Promise.resolve({ dir: '/wf/1' }));
const enqueue = mock(() => Promise.resolve({}));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/workflow/workflow-file-utils', () => ({
  resolveWorkflowDir,
  readWorkflowFile,
  writeWorkflowFile,
  cleanupRootWorkflowFiles: () => Promise.resolve(),
  extractMarkdownFromOutput: () => null,
}));
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../../services/workflow/workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue }) },
}));

const { attemptCiRepair } = await import('../../services/workflow/ci-self-repair');

// NOTE: top-level so BOTH describe blocks (legacy + ciContext) get fresh mocks.
beforeEach(() => {
  delete process.env.RAPITAS_MAX_CI_REPAIRS;
  mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
  mockPrisma.workflowFile.findFirst.mockReset().mockResolvedValue(null);
  mockPrisma.task.update.mockReset().mockResolvedValue({});
  // Default: no conflict-resolution task match (see ci-self-repair.ts:126) so
  // existing tests keep exercising the normal bounce path.
  mockPrisma.task.findUnique.mockReset().mockResolvedValue(null);
  recordTransition.mockReset().mockResolvedValue(undefined);
  writeWorkflowFile.mockReset().mockResolvedValue('/p/question.md');
  readWorkflowFile.mockReset().mockResolvedValue('');
  enqueue.mockReset().mockResolvedValue({});
  execMock.mockClear();
  execBehavior = () => ({ stdout: '[]', stderr: '' });
});

describe('attemptCiRepair', () => {
  test('plan あり → in-progress + plan_approved へ差し戻し、再投入すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });

    const r = await attemptCiRepair(1, ['Check Frontend']);

    expect(r.bounced).toBe(true);
    expect(r.attempt).toBe(1);
    const tu = mockPrisma.task.update.mock.calls[0][0] as {
      data: { status: string; workflowStatus: string };
    };
    expect(tu.data.status).toBe('in-progress');
    expect(tu.data.workflowStatus).toBe('plan_approved');
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe('ci_repair');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test('plan なし → research_done へ差し戻し', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue(null);
    const r = await attemptCiRepair(1, ['Lint Code']);
    const tu = mockPrisma.task.update.mock.calls[0][0] as { data: { workflowStatus: string } };
    expect(tu.data.workflowStatus).toBe('research_done');
    expect(r.bounced).toBe(true);
  });

  test('上限到達で bounced:false（レビュー待ちへ）になり、再投入しないこと', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(2); // == default max
    const r = await attemptCiRepair(1, ['Test Backend']);
    expect(r.bounced).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('FAIL CLOSED: カウントクエリが reject しても bounced:false（レビュー待ち）になり、再投入しないこと', async () => {
    // Fault injection: a prior `.catch(() => 0)` here made a DB hiccup read as
    // "0 prior repairs" (always < max), so the loop kept bouncing forever
    // instead of ever reaching the exhausted/review-wait branch.
    mockPrisma.workflowTransition.count.mockRejectedValue(new Error('connection reset'));
    const r = await attemptCiRepair(1, ['Test Backend']);
    expect(r.bounced).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
    expect(recordTransition).not.toHaveBeenCalled();
    // Must NOT have proceeded to reset the task for a re-run.
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
  });

  test('差し戻しフィードバックを verify.md に追記し、失敗チェック名を明記すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    await attemptCiRepair(1, ['Check Frontend', 'Lint Code']);
    expect(writeWorkflowFile).toHaveBeenCalled();
    const args = writeWorkflowFile.mock.calls[0] as unknown[];
    expect(args[1]).toBe('verify');
    const content = args[2] as string;
    expect(content).toContain('CIからの差し戻し');
    expect(content).toContain('Check Frontend');
    expect(content).toContain('Lint Code');
  });

  test('境界値: prior = max-1 は bounce する（attempt = max）こと', async () => {
    // Default max is 2 (DEFAULT_MAX_CI_REPAIRS); prior=1 is the last bounce-able attempt.
    mockPrisma.workflowTransition.count.mockResolvedValue(1);
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptCiRepair(1, ['Test Backend']);
    expect(r.bounced).toBe(true);
    expect(r.attempt).toBe(2);
  });

  test('競合解消タスク（PR #N の競合を解消）は CI-repair をスキップし completed のまま残ること', async () => {
    // NOTE: Regression guard — re-running the agent on a conflict-resolution
    // task finds no conflict left and cannot fix a CI bug, so bouncing it merely
    // un-completes an already-finished task (observed task 280 bug).
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'PR #123 の競合を解消',
      githubPrId: 42,
    });
    const r = await attemptCiRepair(5, ['Test Backend']);
    expect(r.bounced).toBe(false);
    expect(mockPrisma.workflowTransition.count).not.toHaveBeenCalled();
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test('タイトルが似ていても githubPrId が無ければ通常どおり CI-repair すること', async () => {
    // The conflict-task skip requires BOTH the title pattern AND a linked PR —
    // a task merely titled similarly (no PR yet) must not be skipped.
    mockPrisma.task.findUnique.mockResolvedValue({
      title: 'PR #123 の競合を解消',
      githubPrId: null,
    });
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptCiRepair(5, ['Test Backend']);
    expect(r.bounced).toBe(true);
  });

  test('タイトルが競合解消パターンに一致しない通常タスクは CI-repair すること', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ title: 'Add dark mode toggle', githubPrId: 99 });
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    const r = await attemptCiRepair(5, ['Test Backend']);
    expect(r.bounced).toBe(true);
  });

  test('re-enqueue が非重複エラーで失敗した場合、status を todo に戻し workflow_queue_enqueue_failed を記録すること', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    enqueue.mockRejectedValueOnce(new Error('DB connection timeout'));

    const r = await attemptCiRepair(1, ['Test Backend']);

    expect(r.bounced).toBe(true); // the CI-repair bounce itself still succeeded
    // Second task.update call (first is the in-progress reset) reverts to todo.
    const revertCall = mockPrisma.task.update.mock.calls[1][0] as { data: { status: string } };
    expect(revertCall.data.status).toBe('todo');
    // Second recordTransition call (first is ci_repair) records the new cause.
    const secondTransition = recordTransition.mock.calls[1][0] as {
      fromStatus: string;
      toStatus: string;
      cause: string;
      metadata: { reason: string; error: string; taskStatusFrom: string; taskStatusTo: string };
    };
    expect(secondTransition.cause).toBe('workflow_queue_enqueue_failed');
    expect(secondTransition.metadata.reason).toBe('enqueue_failed');
    expect(secondTransition.metadata.error).toBe('DB connection timeout');
    // fromStatus/toStatus track WORKFLOW status (unchanged — plan_approved here,
    // since a plan.md exists), matching the agent_lifecycle_shutdown_revert
    // convention; the actual task.status flip is asserted via metadata below.
    expect(secondTransition.fromStatus).toBe('plan_approved');
    expect(secondTransition.toStatus).toBe('plan_approved');
    expect(secondTransition.metadata.taskStatusFrom).toBe('in-progress');
    expect(secondTransition.metadata.taskStatusTo).toBe('todo');
  });

  test('re-enqueue が "already in the queue" で失敗した場合は todo に戻さないこと', async () => {
    mockPrisma.workflowFile.findFirst.mockResolvedValue({ id: 7 });
    enqueue.mockRejectedValueOnce(new Error('Task 1 is already in the queue (status: queued)'));

    const r = await attemptCiRepair(1, ['Test Backend']);

    expect(r.bounced).toBe(true);
    // Only the initial in-progress reset — no todo-revert update.
    expect(mockPrisma.task.update).toHaveBeenCalledTimes(1);
    // Only the ci_repair transition — no enqueue-failure transition.
    expect(recordTransition).toHaveBeenCalledTimes(1);
  });
});

describe('attemptCiRepair — CIログ抜粋 (ciContext)', () => {
  const ciContext = { cwd: '/repo', prNumber: 9 };

  /** gh 応答を組み立てる: pr checks / run view --job / headRefOid で分岐する。 */
  function ghBehavior(logsByJobId: Record<string, string>, checksJson?: string) {
    const checks = Object.keys(logsByJobId).map((jobId, i) => ({
      name: `Check ${i + 1}`,
      bucket: 'fail',
      link: `https://github.com/o/r/actions/runs/1/job/${jobId}`,
    }));
    return (cmd: string): { stdout: string; stderr: string } | Error => {
      if (cmd.includes('pr checks'))
        return { stdout: checksJson ?? JSON.stringify(checks), stderr: '' };
      if (cmd.includes('run view')) {
        const jobId = cmd.match(/--job (\d+)/)?.[1] ?? '';
        return { stdout: logsByJobId[jobId] ?? '', stderr: '' };
      }
      if (cmd.includes('headRefOid')) return { stdout: '{"headRefOid":"sha-abc"}', stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
  }

  /** writeWorkflowFile に渡された verify.md 本文を取り出す。 */
  function writtenFeedback(): string {
    const args = writeWorkflowFile.mock.calls[0] as unknown[];
    expect(args[1]).toBe('verify');
    return args[2] as string;
  }

  test('ciContext ありでログ抜粋セクションと実ログ行がフィードバックに含まれること', async () => {
    execBehavior = ghBehavior({ '111': 'error TS2345: type mismatch\nFAIL something' });
    await attemptCiRepair(1, ['Check 1'], '', ciContext);

    const content = writtenFeedback();
    expect(content).toContain('## CI ログ抜粋');
    expect(content).toContain('error TS2345: type mismatch');
    expect(content).toContain('FAIL something');
    // headSha が recordTransition の metadata に記録されること（no-diff 検出用）。
    const rt = recordTransition.mock.calls[0][0] as { metadata: { headSha?: string } };
    expect(rt.metadata.headSha).toBe('sha-abc');
  });

  test('60行のログはチェックごと末尾50行に切り詰められること', async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `log-line-${i + 1}`).join('\n');
    execBehavior = ghBehavior({ '111': lines });
    await attemptCiRepair(1, ['Check 1'], '', ciContext);

    const content = writtenFeedback();
    expect(content).toContain('log-line-60');
    expect(content).toContain('log-line-11'); // tail の先頭
    expect(content).not.toContain('log-line-10\n'); // tail 直前の行は含まれない
  });

  test('複数チェックの合計が8KB上限で切り詰められること', async () => {
    // 1チェックあたり ~7.6KB (150文字 × 50行) — 2つ目は残予算に切り詰められる。
    const bigLog = Array.from({ length: 60 }, () => 'x'.repeat(150)).join('\n');
    execBehavior = ghBehavior({ '111': bigLog, '222': bigLog });
    await attemptCiRepair(1, ['Check 1', 'Check 2'], '', ciContext);

    const content = writtenFeedback();
    const excerpt = content.slice(content.indexOf('## CI ログ抜粋'));
    // 8KB 予算 + 切り詰めマーカー + セクション結合子ぶんの僅かな余裕のみ許容。
    expect(Buffer.byteLength(excerpt, 'utf8')).toBeLessThanOrEqual(8 * 1024 + 120);
    expect(excerpt).toContain('…(truncated)');
  });

  test('gh pr checks 失敗時はログ抜粋なしの従来形式に fail-open すること', async () => {
    execBehavior = (cmd) => {
      if (cmd.includes('pr checks')) return Object.assign(new Error('gh down'), { stderr: 'x' });
      if (cmd.includes('headRefOid')) return { stdout: '{"headRefOid":"sha-abc"}', stderr: '' };
      return { stdout: '{}', stderr: '' };
    };
    const r = await attemptCiRepair(1, ['Check Frontend'], '', ciContext);

    expect(r.bounced).toBe(true);
    const content = writtenFeedback();
    expect(content).not.toContain('## CI ログ抜粋');
    expect(content).toContain('CIからの差し戻し');
    expect(content).toContain('Check Frontend');
  });

  test('link に GitHub Actions のジョブIDが無いチェックはスキップされ全体は成功すること', async () => {
    execBehavior = ghBehavior(
      {},
      JSON.stringify([
        { name: 'External CI', bucket: 'fail', link: 'https://external-ci.example.com/build/1' },
      ]),
    );
    const r = await attemptCiRepair(1, ['External CI'], '', ciContext);

    expect(r.bounced).toBe(true);
    const content = writtenFeedback();
    expect(content).not.toContain('## CI ログ抜粋');
    expect(content).toContain('External CI');
  });
});
