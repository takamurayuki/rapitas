/**
 * blocked-retry-dispatch.test
 *
 * Proves ensureRetryDispatch classifies the outcome of the post-reset dispatch
 * attempt into the five fixed values and never throws (task 1238: a blocked
 * retry used to reset to draft with nothing re-dispatching it).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

type ThemeRow = {
  status: string;
  enabled: boolean;
  currentTaskId: number | null;
  order: string;
  companionTasksJson?: string | null;
};
let themeRows: Record<number, ThemeRow | null> = {};
let runningWithTask = 0;
let perThemeLimit: number | undefined;

const fakePrisma = {
  userSettings: {
    findFirst: () =>
      Promise.resolve({ autoRunMaxConcurrency: 4, autoRunMaxConcurrencyPerTheme: perThemeLimit }),
  },
  themeAutoRun: {
    findFirst: (args: { where: { themeId: number } }) =>
      Promise.resolve(themeRows[args.where.themeId] ?? null),
    count: () => Promise.resolve(runningWithTask),
  },
};

mock.module('../../config/database', () => ({ prisma: fakePrisma }));

const { ensureRetryDispatch } = await import('./blocked-retry-dispatch');

// biome-ignore lint: test double
const db = fakePrisma as never;

describe('ensureRetryDispatch (task 1238)', () => {
  beforeEach(() => {
    themeRows = {};
    runningWithTask = 0;
    perThemeLimit = undefined;
  });

  test('running テーマで枠が空き、セレクタが当該タスクを選べば kicked（セレクタは1回、当該 themeId で呼ばれる）', async () => {
    themeRows[7] = { status: 'running', enabled: true, currentTaskId: null, order: 'priority' };
    const select = mock(async (_p: unknown, themeId: number) => {
      themeRows[themeId]!.currentTaskId = 1235;
    });

    const outcome = await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select });

    expect(outcome).toBe('kicked');
    expect(select).toHaveBeenCalledTimes(1);
    expect(select.mock.calls[0][1]).toBe(7);
  });

  test('currentTaskId が他タスクなら slot_busy でセレクタを呼ばない', async () => {
    themeRows[7] = { status: 'running', enabled: true, currentTaskId: 999, order: 'priority' };
    const select = mock(async () => {});

    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select })).toBe('slot_busy');
    expect(select).toHaveBeenCalledTimes(0);
  });

  test('running 以外のテーマは theme_not_running でセレクタを呼ばない', async () => {
    themeRows[7] = {
      status: 'paused_approval',
      enabled: true,
      currentTaskId: null,
      order: 'priority',
    };
    const select = mock(async () => {});

    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select })).toBe(
      'theme_not_running',
    );
    expect(select).toHaveBeenCalledTimes(0);
  });

  test('themeId 無し・テーマ行無しは theme_not_running', async () => {
    const select = mock(async () => {});
    expect(await ensureRetryDispatch(db, { id: 1, themeId: null }, { select })).toBe(
      'theme_not_running',
    );
    expect(await ensureRetryDispatch(db, { id: 1, themeId: 42 }, { select })).toBe(
      'theme_not_running',
    );
    expect(select).toHaveBeenCalledTimes(0);
  });

  test('セレクタが別タスクを選ぶ／何も選ばない場合は not_selected', async () => {
    themeRows[7] = { status: 'running', enabled: true, currentTaskId: null, order: 'priority' };
    const pickedOther = mock(async (_p: unknown, themeId: number) => {
      themeRows[themeId]!.currentTaskId = 500;
    });
    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select: pickedOther })).toBe(
      'not_selected',
    );

    themeRows[7]!.currentTaskId = null;
    const pickedNone = mock(async () => {});
    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select: pickedNone })).toBe(
      'not_selected',
    );
  });

  test('セレクタが例外を投げても error を返し reject しない', async () => {
    themeRows[7] = { status: 'running', enabled: true, currentTaskId: null, order: 'priority' };
    const select = mock(async () => {
      throw new Error('boom');
    });
    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select })).toBe('error');
  });

  test('DB 読み取り失敗も error（fail-open）', async () => {
    const broken = {
      themeAutoRun: {
        findFirst: () => Promise.reject(new Error('db down')),
        count: () => Promise.resolve(0),
      },
    } as never;
    expect(
      await ensureRetryDispatch(broken, { id: 1, themeId: 7 }, { select: async () => {} }),
    ).toBe('error');
  });

  // Task 1552: a theme may run a head plus companions.
  test('per-theme limit 2 with one task running → the selector may add this task', async () => {
    perThemeLimit = 2;
    themeRows[7] = { status: 'running', enabled: true, currentTaskId: 999, order: 'priority' };
    const select = mock(async (_p: unknown, themeId: number) => {
      themeRows[themeId]!.companionTasksJson = '[{"taskId":1235,"since":1}]';
    });
    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select })).toBe('kicked');
    expect(select).toHaveBeenCalledTimes(1);
  });

  test('this task already holds a companion slot → slot_busy, no second selection', async () => {
    perThemeLimit = 2;
    themeRows[7] = {
      status: 'running',
      enabled: true,
      currentTaskId: 999,
      order: 'priority',
      companionTasksJson: '[{"taskId":1235,"since":1}]',
    };
    const select = mock(async () => {});
    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select })).toBe('slot_busy');
    expect(select).toHaveBeenCalledTimes(0);
  });

  test('every per-theme slot is taken (head + companion at limit 2) → slot_busy', async () => {
    perThemeLimit = 2;
    themeRows[7] = {
      status: 'running',
      enabled: true,
      currentTaskId: 999,
      order: 'priority',
      companionTasksJson: '[{"taskId":500,"since":1}]',
    };
    expect(await ensureRetryDispatch(db, { id: 1235, themeId: 7 }, { select: mock() })).toBe(
      'slot_busy',
    );
  });
});
