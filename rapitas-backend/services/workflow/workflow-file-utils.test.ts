/**
 * workflow-file-utils.test
 *
 * Fault-injection coverage for writeWorkflowFile()'s archive-before-overwrite
 * step: a REAL archiving failure (not "no prior file") must abort the write
 * instead of silently falling through to overwrite the still-unarchived prior
 * version — otherwise the previous plan/research/verify content is destroyed
 * with no copy ever having been preserved.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const readFile = mock(() => Promise.resolve('old content')) as any;
const writeFile = mock(() => Promise.resolve()) as any;
const mkdirMock = mock(() => Promise.resolve()) as any;
const rename = mock(() => Promise.resolve()) as any;
const statMock = mock(() => Promise.resolve({ mtime: new Date(), size: 10 })) as any;
const rm = mock(() => Promise.resolve()) as any;

mock.module('fs/promises', () => ({
  readFile,
  writeFile,
  mkdir: mkdirMock,
  rename,
  stat: statMock,
  rm,
}));

mock.module('../../config', () => ({ prisma: { workflowFile: undefined } }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../utils/common/mojibake-detector', () => ({
  sanitizeMarkdownContent: (text: string) => ({ content: text, wasFixed: false, issues: [] }),
}));
mock.module('./workflow-paths', () => ({
  getTaskWorkflowDir: () => 'C:/repo/tasks/0/0/1',
  getArchiveDir: (dir: string) => `${dir}/_archive/ts`,
}));
mock.module('../task/task-resolver', () => ({
  resolveTaskWithThemeAndCategory: mock(() => Promise.resolve(null)),
}));
mock.module('../memory/hypothesis-from-research', () => ({
  fileHypothesesFromResearch: () => Promise.resolve(),
}));
mock.module('../memory/hypothesis-from-verify', () => ({
  applyHypothesisVerdictsFromVerify: () => Promise.resolve(),
}));

const { writeWorkflowFile } = await import('./workflow-file-utils');

beforeEach(() => {
  for (const m of [readFile, writeFile, mkdirMock, rename, statMock, rm]) m.mockReset();
  statMock.mockResolvedValue({ mtime: new Date(), size: 10 });
  mkdirMock.mockResolvedValue(undefined);
  rename.mockResolvedValue(undefined);
  writeFile.mockResolvedValue(undefined);
});

describe('writeWorkflowFile — archive fault injection', () => {
  test('archives the prior version and writes the new content when everything succeeds', async () => {
    await writeWorkflowFile('C:/repo/tasks/0/0/1', 'plan', 'new content');

    expect(rename).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  test('skips archiving silently when there is no prior file (ENOENT)', async () => {
    const enoent = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    statMock.mockRejectedValue(enoent);

    await writeWorkflowFile('C:/repo/tasks/0/0/1', 'plan', 'new content');

    expect(rename).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(1);
  });

  test('aborts WITHOUT overwriting when archiving a real prior file fails for a non-ENOENT reason', async () => {
    // stat succeeds (prior file exists), but the archive rename fails for a
    // real reason (e.g. EBUSY/EPERM on a locked file) — must NOT fall through
    // to writeFile, or the prior version is destroyed with no copy preserved.
    rename.mockRejectedValue(Object.assign(new Error('EBUSY'), { code: 'EBUSY' }));

    await expect(writeWorkflowFile('C:/repo/tasks/0/0/1', 'plan', 'new content')).rejects.toThrow(
      /Failed to archive/,
    );

    expect(writeFile).not.toHaveBeenCalled();
  });

  test('aborts WITHOUT overwriting when the archive mkdir fails for a non-ENOENT reason', async () => {
    mkdirMock.mockImplementation((dir: string) =>
      dir.includes('_archive')
        ? Promise.reject(new Error('disk full'))
        : Promise.resolve(undefined),
    );

    await expect(writeWorkflowFile('C:/repo/tasks/0/0/1', 'plan', 'new content')).rejects.toThrow(
      /Failed to archive/,
    );

    expect(writeFile).not.toHaveBeenCalled();
  });
});
