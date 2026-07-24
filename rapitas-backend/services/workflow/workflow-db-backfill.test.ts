/**
 * workflow-db-backfill テスト
 *
 * 実ファイルシステム（RAPITAS_DATA_DIR経由の一時ディレクトリ）+ モックDBで、
 * 既存のworkflowディレクトリ配下のmdファイルがWorkflowFileへ取り込まれること、
 * 既にDB行があるタスク/ファイル種別はスキップされること（冪等）、
 * タスクIDとして解釈できないディレクトリ名は無視されることを検証する。
 */
import { afterEach, beforeEach, describe, expect, test, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ORIGINAL_DATA_DIR = process.env.RAPITAS_DATA_DIR;
let dataDir: string;

interface FileRow {
  taskId: number;
  fileType: string;
  content: string;
  sha256: string;
  sizeBytes: number;
  absolutePath: string;
}

let existingRows: Set<string> = new Set(); // `${taskId}:${fileType}` keys that already have a DB row
let createdRows: FileRow[] = [];
const createMock = mock((args: { data: FileRow }) => {
  createdRows.push(args.data);
  return Promise.resolve({ id: createdRows.length, ...args.data });
});
const findUniqueMock = mock(
  (args: { where: { taskId_fileType: { taskId: number; fileType: string } } }) => {
    const key = `${args.where.taskId_fileType.taskId}:${args.where.taskId_fileType.fileType}`;
    return Promise.resolve(existingRows.has(key) ? { id: 1 } : null);
  },
);
// Every task id used across this suite's fixtures — the default "live" set so
// existing tests (which don't care about the orphan-skip path) keep working
// unchanged. Individual tests override `liveTaskIds` to exercise that path.
const ALL_TEST_TASK_IDS = [10, 11, 20, 42];
let liveTaskIds: number[] | null = null;
const taskFindManyMock = mock(() =>
  Promise.resolve((liveTaskIds === null ? ALL_TEST_TASK_IDS : liveTaskIds).map((id) => ({ id }))),
);

mock.module('../../config/database', () => ({
  prisma: {
    task: { findMany: taskFindManyMock },
    workflowFile: {
      findUnique: findUniqueMock,
      create: createMock,
    },
  },
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { backfillWorkflowFilesToDatabase } = await import('./workflow-db-backfill');

function workflowsRoot(): string {
  return join(dataDir, 'workflows');
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wf-db-backfill-'));
  process.env.RAPITAS_DATA_DIR = dataDir;
  existingRows = new Set();
  createdRows = [];
  liveTaskIds = null;
  createMock.mockClear();
  findUniqueMock.mockClear();
  taskFindManyMock.mockClear();
});

afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = ORIGINAL_DATA_DIR;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('backfillWorkflowFilesToDatabase — absent workflow tree', () => {
  test('no workflows directory under RAPITAS_DATA_DIR → returns 0', async () => {
    expect(await backfillWorkflowFilesToDatabase()).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('backfillWorkflowFilesToDatabase — happy path', () => {
  test('backfills tracked markdown files for a task with no existing DB rows', async () => {
    const taskDir = join(workflowsRoot(), '1', '2', '42');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), '# 調査レポート\n本文');
    writeFileSync(join(taskDir, 'plan.md'), '# 実装計画\n本文');

    const copied = await backfillWorkflowFilesToDatabase();

    expect(copied).toBe(2);
    expect(createdRows).toHaveLength(2);
    const research = createdRows.find((r) => r.fileType === 'research');
    expect(research?.taskId).toBe(42);
    expect(research?.content).toBe('# 調査レポート\n本文');
    expect(research?.sizeBytes).toBe(Buffer.byteLength('# 調査レポート\n本文', 'utf-8'));
  });

  test('skips a fileType that already has a WorkflowFile row (idempotent)', async () => {
    const taskDir = join(workflowsRoot(), '1', '2', '42');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), 'source content');
    existingRows.add('42:research');

    const copied = await backfillWorkflowFilesToDatabase();

    expect(copied).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('ignores a task-directory name that does not parse as a number', async () => {
    const taskDir = join(workflowsRoot(), '1', '2', 'not-a-task-id');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), 'orphan');

    const copied = await backfillWorkflowFilesToDatabase();

    expect(copied).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  test('backfills across multiple tasks/themes/categories', async () => {
    mkdirSync(join(workflowsRoot(), '1', '2', '10'), { recursive: true });
    mkdirSync(join(workflowsRoot(), '3', '4', '20'), { recursive: true });
    writeFileSync(join(workflowsRoot(), '1', '2', '10', 'verify.md'), 'v10');
    writeFileSync(join(workflowsRoot(), '3', '4', '20', 'question.md'), 'q20');

    const copied = await backfillWorkflowFilesToDatabase();

    expect(copied).toBe(2);
    expect(createdRows.map((r) => r.taskId).sort()).toEqual([10, 20]);
  });

  test('a create() failure for one file does not abort the rest of the walk', async () => {
    mkdirSync(join(workflowsRoot(), '1', '2', '10'), { recursive: true });
    mkdirSync(join(workflowsRoot(), '1', '2', '11'), { recursive: true });
    writeFileSync(join(workflowsRoot(), '1', '2', '10', 'research.md'), 'fails');
    writeFileSync(join(workflowsRoot(), '1', '2', '11', 'research.md'), 'succeeds');

    createMock.mockImplementationOnce(() => Promise.reject(new Error('FK violation')));

    const copied = await backfillWorkflowFilesToDatabase();

    expect(copied).toBe(1);
    expect(createdRows).toHaveLength(1);
    expect(createdRows[0].taskId).toBe(11);
  });

  // Regression: a task directory whose Task row was since deleted made every
  // create() FK-violate, forever, on EVERY boot — the walk never learned the
  // directory was permanently doomed. Skip it up front via a single
  // task.findMany() instead of re-attempting (and re-logging) a doomed insert
  // per orphaned dir × tracked file type on every single startup.
  test('skips a task directory whose Task row no longer exists, without touching workflowFile at all', async () => {
    mkdirSync(join(workflowsRoot(), '1', '2', '10'), { recursive: true });
    mkdirSync(join(workflowsRoot(), '1', '2', '999'), { recursive: true }); // orphan: not in liveTaskIds
    writeFileSync(join(workflowsRoot(), '1', '2', '10', 'research.md'), 'lives');
    writeFileSync(join(workflowsRoot(), '1', '2', '999', 'research.md'), 'orphaned');
    liveTaskIds = [10];

    const copied = await backfillWorkflowFilesToDatabase();

    expect(copied).toBe(1);
    expect(createdRows.map((r) => r.taskId)).toEqual([10]);
    // Only the live task's 4 tracked file types are checked — the orphaned
    // dir (999) never reaches a single workflowFile lookup.
    expect(findUniqueMock).toHaveBeenCalledTimes(4);
    expect(
      findUniqueMock.mock.calls.every((c: any) => c[0].where.taskId_fileType.taskId === 10),
    ).toBe(true);
    expect(taskFindManyMock).toHaveBeenCalledTimes(1);
  });
});
