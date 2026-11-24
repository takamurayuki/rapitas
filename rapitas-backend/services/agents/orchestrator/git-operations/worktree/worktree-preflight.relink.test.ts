/**
 * worktree-preflight.relink.test
 *
 * 2026-11-24: #1717 changed the root node_modules of a target-project worktree
 * from one junction to a real directory of junctions, so pnpm 12 can write its
 * task run state. A worktree created before it kept the old junction: the
 * reuse preflight saw a usable install and returned before the bootstrap that
 * re-links it, and TempoRaid 1420 hit ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH again.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';

const execMock = mock(
  (_command: string, options: unknown, callback?: (e: Error | null, r?: unknown) => void) => {
    const cb = (typeof options === 'function' ? options : callback) as
      | ((e: Error | null, r?: unknown) => void)
      | undefined;
    cb?.(null, { stdout: '', stderr: '' });
    return { kill: mock(() => undefined) };
  },
);
const execFileMock = mock(() => ({ kill: mock(() => undefined) }));
mock.module('node:child_process', () => ({ exec: execMock, execFile: execFileMock }));
mock.module('child_process', () => ({ exec: execMock, execFile: execFileMock }));
mock.module('../../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { preflightWorktree } = await import('./worktree-preflight');

const TMP_ROOT = resolve('.tmp-tests/worktree-preflight-relink');
const MAIN_NM = join(TMP_ROOT, 'main', 'node_modules');

/** Remove the fixture without following any junction. */
function removeTree(p: string): void {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    try {
      fs.unlinkSync(p);
    } catch {
      fs.rmdirSync(p);
    }
  } else if (st.isDirectory()) {
    for (const name of fs.readdirSync(p)) removeTree(join(p, name));
    fs.rmdirSync(p);
  } else fs.unlinkSync(p);
}

/** A root built by linkRootEntries: a real directory carrying its marker. */
function makeManagedRoot(nm: string): void {
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(join(nm, '.rapitas-linked-root'), JSON.stringify({ version: 1, files: [] }));
}

function makeWorktree(name: string): string {
  const dir = join(TMP_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'package.json'), '{}');
  return dir;
}

beforeEach(() => {
  removeTree(TMP_ROOT);
  for (const entry of ['.bin', '.pnpm', '.pnpm-task-run-state-v1']) {
    fs.mkdirSync(join(MAIN_NM, entry), { recursive: true });
  }
});

afterEach(() => removeTree(TMP_ROOT));

describe('preflightWorktree — re-linking a worktree set up before #1717', () => {
  test('re-links when the root node_modules is still one junction to the main tree', async () => {
    const dir = makeWorktree('legacy-junction');
    fs.symlinkSync(MAIN_NM, join(dir, 'node_modules'), 'junction');
    const bootstrap = mock(() => Promise.resolve({ action: 'linked', detail: '' }));

    await preflightWorktree(dir, { bootstrap });

    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  test("re-links when pnpm's state directory inside the root is a junction", async () => {
    const dir = makeWorktree('linked-state');
    const nm = join(dir, 'node_modules');
    makeManagedRoot(nm);
    for (const entry of ['.bin', '.pnpm', '.pnpm-task-run-state-v1']) {
      fs.symlinkSync(join(MAIN_NM, entry), join(nm, entry), 'junction');
    }
    const bootstrap = mock(() => Promise.resolve({ action: 'linked', detail: '' }));

    await preflightWorktree(dir, { bootstrap });

    expect(bootstrap).toHaveBeenCalledTimes(1);
  });

  test('leaves a root that is already a real directory of links alone', async () => {
    const dir = makeWorktree('current-layout');
    const nm = join(dir, 'node_modules');
    makeManagedRoot(nm);
    fs.mkdirSync(join(nm, '.pnpm-task-run-state-v1'));
    for (const entry of ['.bin', '.pnpm']) {
      fs.symlinkSync(join(MAIN_NM, entry), join(nm, entry), 'junction');
    }
    const bootstrap = mock(() => Promise.resolve({ action: 'linked', detail: '' }));

    await preflightWorktree(dir, { bootstrap });

    expect(bootstrap).not.toHaveBeenCalled();
  });
});
