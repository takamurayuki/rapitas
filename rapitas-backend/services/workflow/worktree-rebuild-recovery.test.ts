/**
 * worktree-rebuild-recovery.test
 *
 * Unit tests for the history-contamination worktree rebuild: cap enforcement,
 * non-contaminated fall-through, the full happy path (snapshot → tag →
 * removeWorktree(deleteBranch=false) → createWorktree → patch apply → session
 * update → transition record, with strict ordering), and the
 * patch-apply-conflict abort. git (node:child_process), prisma, worktree-ops
 * and the verifier helpers are mocked; the classifier runs for real (pure).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Mock state (reconfigured per test in beforeEach)
// ---------------------------------------------------------------------------

type GitResult = { stdout: string; stderr: string };
type GitHandler = (args: string[]) => Promise<GitResult>;

let gitHandler: GitHandler;
/** Every git invocation: [cwd, ...argv]. */
let gitCalls: { cwd: string; args: string[] }[] = [];
/** Cross-mock ordering trace (git verbs + worktree ops). */
let callSeq: string[] = [];

const execFileMock = mock((...allArgs: unknown[]) => {
  const args = (Array.isArray(allArgs[1]) ? allArgs[1] : []) as string[];
  const opts = (allArgs[2] ?? {}) as { cwd?: string };
  const callback = allArgs
    .slice()
    .reverse()
    .find((a) => typeof a === 'function') as
    | ((err: Error | null, result: GitResult) => void)
    | undefined;
  gitCalls.push({ cwd: opts.cwd ?? '', args });
  callSeq.push(`git:${args[0] ?? ''}`);
  Promise.resolve()
    .then(() => gitHandler(args))
    .then((r) => callback?.(null, r))
    .catch((e: Error) => callback?.(e, { stdout: '', stderr: '' }));
});
// The transitive import graph (config chain) also pulls exec/execSync/spawn
// from node:child_process — export inert stand-ins alongside the real mock.
mock.module('node:child_process', () => ({
  execFile: execFileMock,
  exec: mock(() => {}),
  execSync: mock(() => Buffer.from('')),
  spawn: mock(() => ({ on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} } })),
  spawnSync: mock(() => ({ status: 0, stdout: '', stderr: '' })),
  fork: mock(() => ({ on: () => {} })),
}));

let transitionCount: number;
let taskRow: unknown;
let firstSessionRow: { createdAt: Date } | null;
let latestSessionRow: { id: number; branchName: string | null } | null;
const sessionUpdateMock = mock(() => Promise.resolve({}));
mock.module('../../config/database', () => ({
  // Full mirror: config/index re-imports ensureDatabaseConnection from this
  // module, and bun's mock.module replaces it for every importer.
  ensureDatabaseConnection: mock(() => Promise.resolve()),
  prisma: {
    workflowTransition: { count: mock(() => Promise.resolve(transitionCount)) },
    task: { findUnique: mock(() => Promise.resolve(taskRow)) },
    agentSession: {
      findFirst: mock((q: { orderBy?: { createdAt?: string } }) =>
        Promise.resolve(q?.orderBy?.createdAt === 'asc' ? firstSessionRow : latestSessionRow),
      ),
      update: sessionUpdateMock,
    },
  },
}));

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
mock.module('../../config/logger', () => ({
  // Full mirror: config/index also re-imports `logger` and getBackendLogFilePath.
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '',
}));

let newWorktreePath: string;
const removeWorktreeMock = mock((_baseDir: string, wtPath: string, _deleteBranch?: boolean) => {
  callSeq.push('removeWorktree');
  fs.rmSync(wtPath, { recursive: true, force: true });
  return Promise.resolve();
});
const createWorktreeMock = mock(() => {
  callSeq.push('createWorktree');
  return Promise.resolve(newWorktreePath);
});
mock.module('../agents/orchestrator/git-operations/worktree-ops', () => ({
  createWorktree: createWorktreeMock,
  removeWorktree: removeWorktreeMock,
}));

const diffBaseRefMock = mock(() => Promise.resolve('MERGE_BASE'));
let allChangedFiles: string[] = [];
mock.module('../agents/verification/automated-verifier', () => ({
  diffBaseRef: diffBaseRefMock,
  getAllChangedFiles: mock(() => Promise.resolve(allChangedFiles)),
}));

let planContent: string | null;
mock.module('./workflow-file-utils', () => ({
  readWorkflowFile: mock(() => Promise.resolve(planContent)),
}));

const recordTransitionMock = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({
  recordTransition: recordTransitionMock,
}));

const { attemptWorktreeRebuildRecovery, tryRecoverFromHistoryContamination } = await import(
  './worktree-rebuild-recovery'
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_START = new Date('2026-08-01T10:00:00Z');
const PRE_SESSION_ISO = '2026-08-01T09:00:00+00:00';
const POST_SESSION_ISO = '2026-08-01T11:00:00+00:00';

let baseDir: string;
let oldWorktreePath: string;

/** git behavior for the full happy path; individual tests override pieces. */
function happyPathGitHandler(overrides?: {
  logLine?: string;
  applyFails?: boolean;
  diffOutput?: string;
}): GitHandler {
  return (args: string[]) => {
    switch (args[0]) {
      case 'log':
        return Promise.resolve({
          stdout: overrides?.logLine ?? `CONTAM_SHA|${PRE_SESSION_ISO}\n`,
          stderr: '',
        });
      case 'add':
        return Promise.resolve({ stdout: '', stderr: '' });
      case 'stash':
        return Promise.resolve({ stdout: 'SNAPSHOT_SHA\n', stderr: '' });
      case 'rev-parse':
        return Promise.resolve({
          stdout: args.includes('--abbrev-ref') ? 'feature/x-recovered\n' : 'HEAD_SHA\n',
          stderr: '',
        });
      case 'tag':
        return Promise.resolve({ stdout: '', stderr: '' });
      case 'diff':
        return Promise.resolve({
          stdout: overrides?.diffOutput ?? 'diff --git a/src/mine.ts b/src/mine.ts\n',
          stderr: '',
        });
      case 'apply':
        if (overrides?.applyFails) return Promise.reject(new Error('patch does not apply'));
        return Promise.resolve({ stdout: '', stderr: '' });
      default:
        return Promise.resolve({ stdout: '', stderr: '' });
    }
  };
}

beforeEach(() => {
  gitCalls = [];
  callSeq = [];
  execFileMock.mockClear();
  sessionUpdateMock.mockClear();
  removeWorktreeMock.mockClear();
  createWorktreeMock.mockClear();
  diffBaseRefMock.mockClear();
  recordTransitionMock.mockClear();

  transitionCount = 0;
  baseDir = fs.mkdtempSync(join(tmpdir(), 'rapitas-rebuild-base-'));
  oldWorktreePath = fs.mkdtempSync(join(tmpdir(), 'rapitas-rebuild-old-'));
  newWorktreePath = fs.mkdtempSync(join(tmpdir(), 'rapitas-rebuild-new-'));
  taskRow = {
    workingDirectory: null,
    theme: {
      repositoryUrl: 'https://github.com/example/repo',
      workingDirectory: baseDir,
      defaultBranch: 'develop',
    },
  };
  firstSessionRow = { createdAt: SESSION_START };
  latestSessionRow = { id: 77, branchName: 'feature/task-540-x' };
  planContent = null;
  allChangedFiles = [];
  gitHandler = happyPathGitHandler();
});

// ---------------------------------------------------------------------------
// attemptWorktreeRebuildRecovery
// ---------------------------------------------------------------------------

describe('attemptWorktreeRebuildRecovery', () => {
  test('cap到達時は即座に recovery_already_used を返し、git操作を一切行わないこと', async () => {
    transitionCount = 1;
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: ['src/old.ts'],
      preferredBaseBranch: 'develop',
    });
    expect(result).toEqual({ recovered: false, reason: 'recovery_already_used' });
    expect(gitCalls).toHaveLength(0);
    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });

  test('offendingFiles が空なら no_offending_files を返すこと', async () => {
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: [],
      preferredBaseBranch: 'develop',
    });
    expect(result).toEqual({ recovered: false, reason: 'no_offending_files' });
  });

  test('セッション未検出なら session_not_found を返すこと', async () => {
    firstSessionRow = null;
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: ['src/old.ts'],
      preferredBaseBranch: 'develop',
    });
    expect(result).toEqual({ recovered: false, reason: 'session_not_found' });
  });

  test('セッション開始後のコミットのみなら not_history_contaminated で中止し、worktreeを壊さないこと', async () => {
    gitHandler = happyPathGitHandler({ logLine: `IN_SESSION_SHA|${POST_SESSION_ISO}\n` });
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: ['src/mine.ts'],
      preferredBaseBranch: 'develop',
    });
    expect(result).toEqual({ recovered: false, reason: 'not_history_contaminated' });
    expect(removeWorktreeMock).not.toHaveBeenCalled();
    expect(createWorktreeMock).not.toHaveBeenCalled();
    expect(fs.existsSync(oldWorktreePath)).toBe(true);
  });

  test('正常系: snapshot→tag→removeWorktree(deleteBranch=false)→createWorktree→apply→session更新→transition記録の順で完走すること', async () => {
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: ['src/old.ts'],
      preferredBaseBranch: 'develop',
    });

    expect(result.recovered).toBe(true);
    expect(result.newWorktreePath).toBe(newWorktreePath);
    expect(result.newBranchName).toBe('feature/x-recovered');

    // removeWorktree must run BEFORE createWorktree (ground-truth reuse guard),
    // and the snapshot tag must land BEFORE removal.
    expect(callSeq.indexOf('git:tag')).toBeLessThan(callSeq.indexOf('removeWorktree'));
    expect(callSeq.indexOf('removeWorktree')).toBeLessThan(callSeq.indexOf('createWorktree'));

    // deleteBranch=false is mandatory (制約4: never delete the other task's branch).
    const [rmBaseDir, rmPath, rmDeleteBranch] = removeWorktreeMock.mock.calls[0] as unknown as [
      string,
      string,
      boolean,
    ];
    expect(rmBaseDir).toBe(baseDir);
    expect(rmPath).toBe(oldWorktreePath);
    expect(rmDeleteBranch).toBe(false);

    // createWorktree receives the theme's repo URL and default branch.
    const createArgs = createWorktreeMock.mock.calls[0] as unknown as [
      string,
      string,
      number,
      string | null,
      string | null,
    ];
    expect(createArgs[0]).toBe(baseDir);
    expect(createArgs[1]).toContain('recovered');
    expect(createArgs[2]).toBe(540);
    expect(createArgs[4]).toBe('develop');

    // The patch diff excludes the contaminated file with pathspec order `. :(exclude)...`.
    const diffCall = gitCalls.find((c) => c.args[0] === 'diff');
    expect(diffCall).toBeDefined();
    expect(diffCall!.args).toEqual([
      'diff',
      'MERGE_BASE',
      'SNAPSHOT_SHA',
      '--',
      '.',
      ':(exclude)src/old.ts',
    ]);

    // Untracked files are staged before `git stash create` (data-loss guard).
    expect(callSeq.indexOf('git:add')).toBeLessThan(callSeq.indexOf('git:stash'));

    // Session pointers switch to the rebuilt worktree.
    const [updateArgs] = sessionUpdateMock.mock.calls[0] as unknown as [
      { where: { id: number }; data: { branchName: string; worktreePath: string } },
    ];
    expect(updateArgs.where).toEqual({ id: 77 });
    expect(updateArgs.data).toEqual({
      branchName: 'feature/x-recovered',
      worktreePath: newWorktreePath,
    });

    // Audit trail: cause=worktree_rebuilt with old/new branch + snapshot tag.
    expect(recordTransitionMock).toHaveBeenCalledTimes(1);
    const [transition] = recordTransitionMock.mock.calls[0] as unknown as [
      {
        taskId: number;
        cause: string;
        actor: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(transition.taskId).toBe(540);
    expect(transition.cause).toBe('worktree_rebuilt');
    expect(transition.actor).toBe('system');
    expect(transition.metadata.oldBranch).toBe('feature/task-540-x');
    expect(transition.metadata.newBranch).toBe('feature/x-recovered');
    expect(String(transition.metadata.snapshotTag)).toStartWith('recovery/task-540-');
    expect(transition.metadata.oldWorktreePath).toBe(oldWorktreePath);
    expect(transition.metadata.newWorktreePath).toBe(newWorktreePath);
    expect(transition.metadata.contaminatedFiles).toEqual(['src/old.ts']);
  });

  test('git apply 失敗時は patch_apply_conflict を返し、session を更新しないこと', async () => {
    gitHandler = happyPathGitHandler({ applyFails: true });
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: ['src/old.ts'],
      preferredBaseBranch: 'develop',
    });
    expect(result).toEqual({ recovered: false, reason: 'patch_apply_conflict' });
    expect(sessionUpdateMock).not.toHaveBeenCalled();
    expect(recordTransitionMock).not.toHaveBeenCalled();
  });

  test('パッチが空（差分なし）なら apply をスキップして完走すること', async () => {
    gitHandler = happyPathGitHandler({ diffOutput: '' });
    const result = await attemptWorktreeRebuildRecovery({
      taskId: 540,
      worktreePath: oldWorktreePath,
      offendingFiles: ['src/old.ts'],
      preferredBaseBranch: 'develop',
    });
    expect(result.recovered).toBe(true);
    expect(callSeq).not.toContain('git:apply');
  });
});

// ---------------------------------------------------------------------------
// tryRecoverFromHistoryContamination
// ---------------------------------------------------------------------------

describe('tryRecoverFromHistoryContamination', () => {
  test('plan.md が無い（lightweight）場合は no_offending_files で終了すること', async () => {
    planContent = null;
    const result = await tryRecoverFromHistoryContamination(540, oldWorktreePath, 'develop');
    expect(result).toEqual({ recovered: false, reason: 'no_offending_files' });
    expect(gitCalls).toHaveLength(0);
  });

  test('全変更が plan スコープ内なら no_offending_files で終了すること', async () => {
    planContent = 'Edit `src/planned.ts` only.';
    allChangedFiles = ['src/planned.ts'];
    const result = await tryRecoverFromHistoryContamination(540, oldWorktreePath, 'develop');
    expect(result).toEqual({ recovered: false, reason: 'no_offending_files' });
  });

  test('計画外ファイルが履歴汚染ならリカバリまで到達すること', async () => {
    // NOTE: parsePlanFiles adds the plan file's PARENT DIR to scope, so the
    // offending file must live outside `src/` to register as out-of-plan.
    planContent = 'Edit `src/planned.ts` only.';
    allChangedFiles = ['src/planned.ts', 'lib/old.ts'];
    const result = await tryRecoverFromHistoryContamination(540, oldWorktreePath, 'develop');
    expect(result.recovered).toBe(true);
    expect(result.newWorktreePath).toBe(newWorktreePath);
  });

  test('worktreePath が無ければ session_not_found を返すこと', async () => {
    const result = await tryRecoverFromHistoryContamination(540, null, 'develop');
    expect(result).toEqual({ recovered: false, reason: 'session_not_found' });
  });
});
