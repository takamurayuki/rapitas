/**
 * workflow-legacy-migrator テスト
 *
 * Real filesystem behavior (no mocking): drives migrateLegacyWorkflowFiles
 * against temp directories, swapping process.cwd() (legacy root) and
 * RAPITAS_DATA_DIR (new root) per test. Covers the happy-path copy, tracked
 * vs untracked filenames, idempotency, non-directory entries at every tree
 * level, and per-file copy failures that must not abort the whole walk.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { migrateLegacyWorkflowFiles } from './workflow-legacy-migrator';

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_DATA_DIR = process.env.RAPITAS_DATA_DIR;

let legacyCwd: string;
let dataDir: string;

function newRoot(): string {
  return join(dataDir, 'workflows');
}

beforeEach(() => {
  legacyCwd = mkdtempSync(join(tmpdir(), 'legacy-migrator-cwd-'));
  dataDir = mkdtempSync(join(tmpdir(), 'legacy-migrator-data-'));
  process.chdir(legacyCwd);
  process.env.RAPITAS_DATA_DIR = dataDir;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = ORIGINAL_DATA_DIR;
  rmSync(legacyCwd, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe('migrateLegacyWorkflowFiles — absent legacy tree', () => {
  test('no "tasks" directory under cwd → returns 0, creates nothing', async () => {
    const copied = await migrateLegacyWorkflowFiles();
    expect(copied).toBe(0);
    expect(existsSync(newRoot())).toBe(false);
  });

  test('"tasks" exists but is a plain file (not a directory) → readdir fails, returns 0', async () => {
    writeFileSync(join(legacyCwd, 'tasks'), 'not a directory');
    const copied = await migrateLegacyWorkflowFiles();
    expect(copied).toBe(0);
  });

  test('"tasks" directory exists but is empty → returns 0', async () => {
    mkdirSync(join(legacyCwd, 'tasks'));
    const copied = await migrateLegacyWorkflowFiles();
    expect(copied).toBe(0);
  });
});

describe('migrateLegacyWorkflowFiles — happy path', () => {
  test('copies only tracked markdown filenames, mirroring the category/theme/task layout', async () => {
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), 'research content');
    writeFileSync(join(taskDir, 'plan.md'), 'plan content');
    writeFileSync(join(taskDir, 'notes.txt'), 'untracked, must be left alone');

    const copied = await migrateLegacyWorkflowFiles();

    expect(copied).toBe(2);
    const dstDir = join(newRoot(), 'catA', 'themeA', 'task1');
    expect(readFileSync(join(dstDir, 'research.md'), 'utf8')).toBe('research content');
    expect(readFileSync(join(dstDir, 'plan.md'), 'utf8')).toBe('plan content');
    expect(existsSync(join(dstDir, 'notes.txt'))).toBe(false);
  });

  test('migrates all four tracked filenames across multiple tasks/themes/categories', async () => {
    mkdirSync(join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1'), { recursive: true });
    mkdirSync(join(legacyCwd, 'tasks', 'catB', 'themeB', 'task2'), { recursive: true });
    writeFileSync(join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1', 'question.md'), 'q');
    writeFileSync(join(legacyCwd, 'tasks', 'catB', 'themeB', 'task2', 'verify.md'), 'v');

    const copied = await migrateLegacyWorkflowFiles();

    expect(copied).toBe(2);
    expect(existsSync(join(newRoot(), 'catA', 'themeA', 'task1', 'question.md'))).toBe(true);
    expect(existsSync(join(newRoot(), 'catB', 'themeB', 'task2', 'verify.md'))).toBe(true);
  });

  test('an empty task directory still gets mkdir-ed at the destination even with nothing to copy', async () => {
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });

    const copied = await migrateLegacyWorkflowFiles();

    expect(copied).toBe(0);
    expect(existsSync(join(newRoot(), 'catA', 'themeA', 'task1'))).toBe(true);
  });
});

describe('migrateLegacyWorkflowFiles — idempotency', () => {
  test('running twice does not re-copy or overwrite already-migrated files', async () => {
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), 'v1');

    expect(await migrateLegacyWorkflowFiles()).toBe(1);

    // Mutate the legacy source after first migration — a second run must not
    // touch the already-migrated destination file.
    writeFileSync(join(taskDir, 'research.md'), 'v2 — should never land');
    expect(await migrateLegacyWorkflowFiles()).toBe(0);

    const dst = join(newRoot(), 'catA', 'themeA', 'task1', 'research.md');
    expect(readFileSync(dst, 'utf8')).toBe('v1');
  });

  test('a pre-existing destination file (from a prior partial migration) is skipped, not overwritten', async () => {
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), 'source');
    writeFileSync(join(taskDir, 'plan.md'), 'source plan');

    const dstDir = join(newRoot(), 'catA', 'themeA', 'task1');
    mkdirSync(dstDir, { recursive: true });
    writeFileSync(join(dstDir, 'research.md'), 'pre-existing, keep me');

    const copied = await migrateLegacyWorkflowFiles();

    // Only plan.md was actually new; research.md was already present.
    expect(copied).toBe(1);
    expect(readFileSync(join(dstDir, 'research.md'), 'utf8')).toBe('pre-existing, keep me');
    expect(readFileSync(join(dstDir, 'plan.md'), 'utf8')).toBe('source plan');
  });
});

describe('migrateLegacyWorkflowFiles — non-directory entries are skipped at every tree level', () => {
  test('a stray file directly under tasks/ (masquerading as a category) is skipped', async () => {
    mkdirSync(join(legacyCwd, 'tasks'), { recursive: true });
    writeFileSync(join(legacyCwd, 'tasks', 'README.md'), 'stray file, not a category dir');
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'plan.md'), 'plan');

    const copied = await migrateLegacyWorkflowFiles();
    expect(copied).toBe(1);
  });

  test('a stray file inside a category dir (masquerading as a theme) is skipped', async () => {
    mkdirSync(join(legacyCwd, 'tasks', 'catA'), { recursive: true });
    writeFileSync(join(legacyCwd, 'tasks', 'catA', 'stray.txt'), 'not a theme dir');
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'verify.md'), 'verify');

    const copied = await migrateLegacyWorkflowFiles();
    expect(copied).toBe(1);
  });

  test('a stray file inside a theme dir (masquerading as a task) is skipped', async () => {
    mkdirSync(join(legacyCwd, 'tasks', 'catA', 'themeA'), { recursive: true });
    writeFileSync(join(legacyCwd, 'tasks', 'catA', 'themeA', 'stray.txt'), 'not a task dir');
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'question.md'), 'question');

    const copied = await migrateLegacyWorkflowFiles();
    expect(copied).toBe(1);
  });
});

describe('migrateLegacyWorkflowFiles — per-file copy failure is isolated', () => {
  test('a tracked name that is actually a directory fails to copy but does not abort the rest of the walk', async () => {
    const taskDir = join(legacyCwd, 'tasks', 'catA', 'themeA', 'task1');
    // "plan.md" is a directory, not a file — copyFile() will throw (EISDIR).
    mkdirSync(join(taskDir, 'plan.md'), { recursive: true });
    writeFileSync(join(taskDir, 'research.md'), 'still copies fine');

    const copied = await migrateLegacyWorkflowFiles();

    expect(copied).toBe(1);
    expect(existsSync(join(newRoot(), 'catA', 'themeA', 'task1', 'research.md'))).toBe(true);
    expect(existsSync(join(newRoot(), 'catA', 'themeA', 'task1', 'plan.md'))).toBe(false);
  });
});
