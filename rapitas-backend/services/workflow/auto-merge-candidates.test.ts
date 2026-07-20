/**
 * auto-merge-candidates.test
 *
 * Coverage for findCandidates(): the two PR-link sources (linkedTaskId +
 * Task.githubPrId fallback, incl. the duplicate-open-PR notify path), the
 * staged-completion admission rule (done vs verify_done-awaiting-CI), mode
 * resolution (merge/pr/null), cwd fallback order, terminal-state gating, and
 * the recent-blocks retry budget. resolveAutomationPolicy and
 * resolveTaskForAutoMerge run for REAL against the mocked prisma below (both
 * import prisma from the same '../../config/database' module), so this is an
 * integration-style test of the whole candidate-selection pipeline.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

interface TaskFixture {
  id: number;
  title: string;
  status: string;
  workflowStatus: string;
  completedAt: Date | null;
  workingDirectory: string | null;
  theme: { workingDirectory: string | null; defaultBranch?: string | null } | null;
  autoCommit?: boolean | null;
  autoCreatePR?: boolean | null;
  autoMergePR?: boolean | null;
}

interface OpenPrRow {
  prNumber: number;
  baseBranch: string | null;
  linkedTaskId: number | null;
}

let openPrRows: OpenPrRow[] = [];
let prTaskRows: { id: number; githubPrId: number | null }[] = [];
let openPrByNumber = new Map<number, { baseBranch: string | null }>();
let notificationRows = new Map<string, { id: number }>();
let tasksById = new Map<number, TaskFixture>();
let userSettingsRow: Record<string, boolean | null> | null = null;
let blockedCountByTask = new Map<number, number>();
let agentConfigByTask = new Map<number, { mergeCommitThreshold: number } | null>();

const notificationCreate = mock(() => Promise.resolve({}));
const decideTerminalState = mock(() =>
  Promise.resolve<{ skip: boolean; kind?: string; reason?: string }>({ skip: false }),
);

const mockPrisma = {
  gitHubPullRequest: {
    findMany: () => Promise.resolve(openPrRows),
    findFirst: (args: { where: { prNumber: number } }) => {
      const row = openPrByNumber.get(args.where.prNumber);
      return Promise.resolve(row ? { baseBranch: row.baseBranch } : null);
    },
  },
  task: {
    findMany: () => Promise.resolve(prTaskRows),
    findUnique: (args: { where: { id: number } }) =>
      Promise.resolve(tasksById.get(args.where.id) ?? null),
  },
  notification: {
    findFirst: (args: { where: { type: string; link: string } }) =>
      Promise.resolve(notificationRows.get(`${args.where.type}:${args.where.link}`) ?? null),
    create: notificationCreate,
  },
  workflowTransition: {
    count: (args: { where: { taskId: number } }) =>
      Promise.resolve(blockedCountByTask.get(args.where.taskId) ?? 0),
  },
  agentExecutionConfig: {
    findUnique: (args: { where: { taskId: number } }) =>
      Promise.resolve(agentConfigByTask.get(args.where.taskId) ?? null),
  },
  userSettings: {
    findFirst: () => Promise.resolve(userSettingsRow),
  },
};

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    debug: mock(() => {}),
  }),
}));

// NOTE: Mirror ALL real exports of auto-merge-exhaustion — bun mock.module is
// process-global. decideTerminalState is the only one exercised here; the
// module's own heavy dependencies (gh CLI, transition recording) are why it
// is mocked wholesale rather than run for real.
mock.module('./auto-merge-exhaustion', () => ({
  EXHAUSTED_CAUSE: 'auto_merge_exhausted',
  resetExhaustedRecheckCooldowns: mock(() => {}),
  markExhausted: mock(() => Promise.resolve()),
  decideTerminalState,
}));

const { findCandidates } = await import('./auto-merge-candidates');

const CWD = process.cwd();

function addTask(overrides: Partial<TaskFixture> & { id: number }): TaskFixture {
  const fixture: TaskFixture = {
    title: `Task ${overrides.id}`,
    status: 'done',
    workflowStatus: 'completed',
    completedAt: new Date(),
    workingDirectory: CWD,
    theme: null,
    autoMergePR: true,
    ...overrides,
  };
  tasksById.set(fixture.id, fixture);
  return fixture;
}

function addOpenPr(row: OpenPrRow): void {
  openPrRows.push(row);
}

beforeEach(() => {
  openPrRows = [];
  prTaskRows = [];
  openPrByNumber = new Map();
  notificationRows = new Map();
  tasksById = new Map();
  userSettingsRow = null;
  blockedCountByTask = new Map();
  agentConfigByTask = new Map();
  notificationCreate.mockClear();
  notificationCreate.mockImplementation(() => Promise.resolve({}));
  decideTerminalState.mockClear();
  decideTerminalState.mockImplementation(() => Promise.resolve({ skip: false }));
  delete process.env.RAPITAS_STAGED_COMPLETION;
});

describe('findCandidates — no work', () => {
  it('returns [] when there are no open linked PRs and no githubPrId tasks', async () => {
    expect(await findCandidates()).toEqual([]);
  });
});

describe('findCandidates — completion gate', () => {
  it('includes a "done" task whose policy resolves autoMergePR (merge mode)', async () => {
    addTask({ id: 1, autoMergePR: true });
    addOpenPr({ prNumber: 100, baseBranch: 'develop', linkedTaskId: 1 });

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      taskId: 1,
      prNumber: 100,
      baseBranch: 'develop',
      mode: 'merge',
    });
  });

  it('excludes an in-progress task that is neither completed nor awaiting CI', async () => {
    addTask({ id: 2, status: 'in-progress', workflowStatus: 'plan_approved', autoMergePR: true });
    addOpenPr({ prNumber: 101, baseBranch: 'develop', linkedTaskId: 2 });

    expect(await findCandidates()).toEqual([]);
  });

  it('excludes a "done" task whose policy has neither autoMergePR nor (staged) autoCreatePR', async () => {
    addTask({ id: 3, autoMergePR: false, autoCreatePR: false });
    addOpenPr({ prNumber: 102, baseBranch: 'develop', linkedTaskId: 3 });

    expect(await findCandidates()).toEqual([]);
  });

  it('excludes a "done" task with autoCreatePR only when staged completion is OFF (already completed at verify)', async () => {
    addTask({ id: 4, autoMergePR: false, autoCreatePR: true });
    addOpenPr({ prNumber: 103, baseBranch: 'develop', linkedTaskId: 4 });

    expect(await findCandidates()).toEqual([]);
  });

  it('admits a verify_done task awaiting CI in "pr" mode when staged completion is ON', async () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'true';
    addTask({
      id: 5,
      status: 'in-progress',
      workflowStatus: 'verify_done',
      autoMergePR: false,
      autoCreatePR: true,
    });
    addOpenPr({ prNumber: 104, baseBranch: 'develop', linkedTaskId: 5 });

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ taskId: 5, mode: 'pr' });
  });

  it('does not admit a non-verify_done, non-completed task even when staged completion is ON', async () => {
    process.env.RAPITAS_STAGED_COMPLETION = '1';
    addTask({ id: 6, status: 'in-progress', workflowStatus: 'plan_approved', autoCreatePR: true });
    addOpenPr({ prNumber: 105, baseBranch: 'develop', linkedTaskId: 6 });

    expect(await findCandidates()).toEqual([]);
  });
});

describe('findCandidates — cwd resolution', () => {
  it('falls back to the theme workingDirectory when the task one does not exist', async () => {
    addTask({
      id: 7,
      workingDirectory: 'C:/definitely/does/not/exist/rapitas-task-dir',
      theme: { workingDirectory: CWD },
    });
    addOpenPr({ prNumber: 106, baseBranch: 'develop', linkedTaskId: 7 });

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0].cwd).toBe(CWD);
  });

  it('skips the candidate entirely when no candidate directory exists on disk', async () => {
    addTask({
      id: 8,
      workingDirectory: 'C:/definitely/does/not/exist/rapitas-task-dir',
      theme: { workingDirectory: 'C:/definitely/does/not/exist/rapitas-theme-dir' },
    });
    addOpenPr({ prNumber: 107, baseBranch: 'develop', linkedTaskId: 8 });

    const originalCwd = process.cwd;
    process.cwd = () => 'C:/definitely/does/not/exist/rapitas-process-cwd';
    try {
      expect(await findCandidates()).toEqual([]);
    } finally {
      process.cwd = originalCwd;
    }
  });
});

describe('findCandidates — terminal state gating', () => {
  it('excludes a candidate whose decideTerminalState says skip (merged)', async () => {
    addTask({ id: 9 });
    addOpenPr({ prNumber: 108, baseBranch: 'develop', linkedTaskId: 9 });
    decideTerminalState.mockImplementation(() => Promise.resolve({ skip: true, kind: 'merged' }));

    expect(await findCandidates()).toEqual([]);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('notifies auto_merge_exhausted exactly when decideTerminalState reports exhausted_now', async () => {
    addTask({ id: 10 });
    addOpenPr({ prNumber: 109, baseBranch: 'develop', linkedTaskId: 10 });
    decideTerminalState.mockImplementation(() =>
      Promise.resolve({ skip: true, kind: 'exhausted_now' }),
    );

    expect(await findCandidates()).toEqual([]);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0] as { data: { type: string } };
    expect(data.data.type).toBe('auto_merge_exhausted');
  });

  it('does not notify for a plain "exhausted" (parked, not newly exhausted) skip', async () => {
    addTask({ id: 11 });
    addOpenPr({ prNumber: 110, baseBranch: 'develop', linkedTaskId: 11 });
    decideTerminalState.mockImplementation(() =>
      Promise.resolve({ skip: true, kind: 'exhausted' }),
    );

    expect(await findCandidates()).toEqual([]);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('passes the resolved taskId/prNumber/cwd through to decideTerminalState', async () => {
    addTask({ id: 12 });
    addOpenPr({ prNumber: 111, baseBranch: 'develop', linkedTaskId: 12 });

    await findCandidates();

    expect(decideTerminalState).toHaveBeenCalledWith(12, 111, CWD);
  });
});

describe('findCandidates — blocked-retry budget', () => {
  it('excludes a candidate that has hit the 3-block retry budget', async () => {
    addTask({ id: 13 });
    addOpenPr({ prNumber: 112, baseBranch: 'develop', linkedTaskId: 13 });
    blockedCountByTask.set(13, 3);

    expect(await findCandidates()).toEqual([]);
  });

  it('admits a candidate with fewer than 3 recent blocks', async () => {
    addTask({ id: 14 });
    addOpenPr({ prNumber: 113, baseBranch: 'develop', linkedTaskId: 14 });
    blockedCountByTask.set(14, 2);

    expect(await findCandidates()).toHaveLength(1);
  });
});

describe('findCandidates — threshold and baseBranch defaults', () => {
  it('defaults mergeCommitThreshold to 5 when no AgentExecutionConfig row exists', async () => {
    addTask({ id: 15 });
    addOpenPr({ prNumber: 114, baseBranch: 'develop', linkedTaskId: 15 });

    const result = await findCandidates();

    expect(result[0].threshold).toBe(5);
  });

  it('uses the configured mergeCommitThreshold when present', async () => {
    addTask({ id: 16 });
    addOpenPr({ prNumber: 115, baseBranch: 'develop', linkedTaskId: 16 });
    agentConfigByTask.set(16, { mergeCommitThreshold: 8 });

    const result = await findCandidates();

    expect(result[0].threshold).toBe(8);
  });

  it('defaults baseBranch to "develop" when the PR row has none and the task has no theme', async () => {
    addTask({ id: 17 });
    addOpenPr({ prNumber: 116, baseBranch: null, linkedTaskId: 17 });

    const result = await findCandidates();

    expect(result[0].baseBranch).toBe('develop');
  });

  it('falls back to the THEME default branch (not a hardcoded "develop") when the PR row has none', async () => {
    addTask({ id: 23, theme: { workingDirectory: CWD, defaultBranch: 'main' } });
    addOpenPr({ prNumber: 117, baseBranch: null, linkedTaskId: 23 });

    const result = await findCandidates();

    expect(result[0].baseBranch).toBe('main');
  });

  it('prefers the PR row baseBranch over the theme default when both are present', async () => {
    addTask({ id: 24, theme: { workingDirectory: CWD, defaultBranch: 'main' } });
    addOpenPr({ prNumber: 118, baseBranch: 'develop', linkedTaskId: 24 });

    const result = await findCandidates();

    expect(result[0].baseBranch).toBe('develop');
  });
});

describe('findCandidates — Task.githubPrId fallback + duplicate-open-PR notify', () => {
  it('adopts a task via githubPrId when no linkedTaskId row names it, using the open PR row baseBranch', async () => {
    addTask({ id: 18 });
    prTaskRows = [{ id: 18, githubPrId: 200 }];
    openPrByNumber.set(200, { baseBranch: 'feature/base' });

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ taskId: 18, prNumber: 200, baseBranch: 'feature/base' });
  });

  it('ignores a githubPrId fallback when no OPEN local PR row matches that number', async () => {
    addTask({ id: 19 });
    prTaskRows = [{ id: 19, githubPrId: 201 }];
    // No entry added to openPrByNumber — simulates no open row for #201.

    expect(await findCandidates()).toEqual([]);
  });

  it('prefers the LATEST PR (Task.githubPrId) over an older linkedTaskId row and notifies once', async () => {
    addTask({ id: 20 });
    addOpenPr({ prNumber: 300, baseBranch: 'develop', linkedTaskId: 20 });
    prTaskRows = [{ id: 20, githubPrId: 302 }];
    openPrByNumber.set(302, { baseBranch: 'develop' });

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0].prNumber).toBe(302);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    const data = notificationCreate.mock.calls[0][0] as { data: { type: string; message: string } };
    expect(data.data.type).toBe('duplicate_open_prs');
    expect(data.data.message).toContain('#300');
    expect(data.data.message).toContain('#302');
  });

  it('does not re-notify a duplicate-open-PR once already notified', async () => {
    addTask({ id: 21 });
    addOpenPr({ prNumber: 400, baseBranch: 'develop', linkedTaskId: 21 });
    prTaskRows = [{ id: 21, githubPrId: 402 }];
    openPrByNumber.set(402, { baseBranch: 'develop' });
    notificationRows.set('duplicate_open_prs:/tasks/21', { id: 1 });

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0].prNumber).toBe(402);
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('does NOT treat a matching linkedTaskId/githubPrId pair as a duplicate', async () => {
    addTask({ id: 22 });
    addOpenPr({ prNumber: 500, baseBranch: 'develop', linkedTaskId: 22 });
    prTaskRows = [{ id: 22, githubPrId: 500 }];

    const result = await findCandidates();

    expect(result).toHaveLength(1);
    expect(result[0].prNumber).toBe(500);
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
