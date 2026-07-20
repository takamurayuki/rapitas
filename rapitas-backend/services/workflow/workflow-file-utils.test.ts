/**
 * workflow-file-utils.test
 *
 * DB-backed behavior for read/write/archive: writeWorkflowFile archives any
 * PRIOR row into WorkflowFileVersion before upserting new content (so a
 * regenerated plan never silently destroys the previous version);
 * archiveWorkflowFile moves the current row out and clears it; readWorkflowFile
 * falls back to a legacy on-disk file (write-through) only when the DB has
 * nothing yet — the transient backfill-race safety net.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface StoredFile {
  content: string;
  sha256: string;
  sizeBytes: number;
}

let store: Map<string, StoredFile> = new Map();
let versions: Array<{ taskId: number; fileType: string; content: string }> = [];

function key(taskId: number, fileType: string): string {
  return `${taskId}:${fileType}`;
}

const txWorkflowFile = {
  findUnique: mock((args: { where: { taskId_fileType: { taskId: number; fileType: string } } }) =>
    Promise.resolve(
      store.get(key(args.where.taskId_fileType.taskId, args.where.taskId_fileType.fileType)) ??
        null,
    ),
  ),
  upsert: mock(
    (args: {
      where: { taskId_fileType: { taskId: number; fileType: string } };
      create: StoredFile;
    }) => {
      store.set(key(args.where.taskId_fileType.taskId, args.where.taskId_fileType.fileType), {
        content: args.create.content,
        sha256: args.create.sha256,
        sizeBytes: args.create.sizeBytes,
      });
      return Promise.resolve({});
    },
  ),
  delete: mock((args: { where: { taskId_fileType: { taskId: number; fileType: string } } }) => {
    store.delete(key(args.where.taskId_fileType.taskId, args.where.taskId_fileType.fileType));
    return Promise.resolve({});
  }),
};

const txWorkflowFileVersion = {
  create: mock((args: { data: { taskId: number; fileType: string; content: string } }) => {
    versions.push(args.data);
    return Promise.resolve({});
  }),
};

const findUniqueTopLevel = mock(
  (args: { where: { taskId_fileType: { taskId: number; fileType: string } } }) =>
    Promise.resolve(
      store.get(key(args.where.taskId_fileType.taskId, args.where.taskId_fileType.fileType)) ??
        null,
    ),
);

mock.module('../../config', () => ({
  prisma: {
    workflowFile: { findUnique: findUniqueTopLevel },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ workflowFile: txWorkflowFile, workflowFileVersion: txWorkflowFileVersion }),
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../utils/common/mojibake-detector', () => ({
  sanitizeMarkdownContent: (text: string) => ({ content: text, wasFixed: false, issues: [] }),
}));
mock.module('./workflow-paths', () => ({
  getTaskWorkflowDir: () => 'C:/repo/tasks/0/0/1',
}));
mock.module('../task/task-resolver', () => ({
  resolveTaskWithThemeAndCategory: mock(() =>
    Promise.resolve({ theme: { categoryId: null }, themeId: null }),
  ),
}));
mock.module('../memory/hypothesis-from-research', () => ({
  fileHypothesesFromResearch: () => Promise.resolve(),
}));
mock.module('../memory/hypothesis-from-verify', () => ({
  applyHypothesisVerdictsFromVerify: () => Promise.resolve(),
}));

let legacyFileContent: string | null = null;
mock.module('fs/promises', () => ({
  readFile: () =>
    legacyFileContent != null
      ? Promise.resolve(legacyFileContent)
      : Promise.reject(new Error('ENOENT')),
}));

const { readWorkflowFile, writeWorkflowFile, archiveWorkflowFile } =
  await import('./workflow-file-utils');

beforeEach(() => {
  store = new Map();
  versions = [];
  legacyFileContent = null;
  for (const m of [
    txWorkflowFile.findUnique,
    txWorkflowFile.upsert,
    txWorkflowFile.delete,
    txWorkflowFileVersion.create,
    findUniqueTopLevel,
  ]) {
    m.mockClear();
  }
});

describe('writeWorkflowFile', () => {
  test('no prior row: creates content with no version archived', async () => {
    await writeWorkflowFile(1, 'plan', 'new content');

    expect(store.get('1:plan')?.content).toBe('new content');
    expect(versions).toHaveLength(0);
  });

  test('prior row exists: archives it into WorkflowFileVersion before overwriting', async () => {
    store.set('1:plan', { content: 'old content', sha256: 'x', sizeBytes: 11 });

    await writeWorkflowFile(1, 'plan', 'new content');

    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ taskId: 1, fileType: 'plan', content: 'old content' });
    expect(store.get('1:plan')?.content).toBe('new content');
  });

  test('returns the sanitized content actually saved', async () => {
    const saved = await writeWorkflowFile(1, 'research', 'content');
    expect(saved).toBe('content');
  });
});

describe('archiveWorkflowFile', () => {
  test('moves the current row into WorkflowFileVersion and clears it', async () => {
    store.set('1:plan', { content: 'to archive', sha256: 'x', sizeBytes: 10 });

    const result = await archiveWorkflowFile(1, 'plan');

    expect(result).toBe(true);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ taskId: 1, fileType: 'plan', content: 'to archive' });
    expect(store.has('1:plan')).toBe(false);
  });

  test('no existing row: returns false, archives nothing', async () => {
    const result = await archiveWorkflowFile(1, 'plan');
    expect(result).toBe(false);
    expect(versions).toHaveLength(0);
  });
});

describe('readWorkflowFile', () => {
  test('returns the DB row content directly when present', async () => {
    store.set('1:research', { content: 'db content', sha256: 'x', sizeBytes: 10 });
    expect(await readWorkflowFile(1, 'research')).toBe('db content');
  });

  test('DB empty + legacy file present: reads it and writes through to the DB', async () => {
    legacyFileContent = 'legacy on-disk content';

    const result = await readWorkflowFile(1, 'research');

    expect(result).toBe('legacy on-disk content');
    expect(store.get('1:research')?.content).toBe('legacy on-disk content');
  });

  test('DB empty and no legacy file either: returns null', async () => {
    expect(await readWorkflowFile(1, 'research')).toBeNull();
  });
});
