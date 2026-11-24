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
import * as os from 'node:os';
import { join } from 'node:path';

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
const { linkNodeModules } = await import('./node-modules-link');

const TMP_ROOT = fs.mkdtempSync(join(os.tmpdir(), 'worktree-preflight-relink-'));
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
  const dir = join(TMP_ROOT, 'main', '.worktrees', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'package.json'), '{}');
  return dir;
}

/** 実リンクを使う workspace fixture。ルートの .bin で早期 return 条件も成立させる。 */
function makeWorkspaceFixture(packageLevel: boolean) {
  const base = fs.mkdtempSync(join(os.tmpdir(), 'preflight-workspace-'));
  const main = join(base, 'main');
  const dir = join(main, '.worktrees', 'task-1534-workspace');
  const mainCore = join(main, 'packages', 'core');
  const worktreeCore = join(dir, 'packages', 'core');
  for (const core of [mainCore, worktreeCore]) {
    fs.mkdirSync(core, { recursive: true });
    fs.writeFileSync(join(core, 'index.ts'), core === mainCore ? 'main' : 'worktree');
  }
  fs.writeFileSync(join(dir, 'package.json'), '{}');
  fs.mkdirSync(join(main, 'node_modules', '.bin'), { recursive: true });
  const rel = packageLevel ? 'apps/server' : '';
  const mainNm = join(main, rel, 'node_modules');
  fs.mkdirSync(join(mainNm, '@scope'), { recursive: true });
  fs.mkdirSync(join(dir, rel), { recursive: true });
  fs.symlinkSync(mainCore, join(mainNm, '@scope', 'core'), 'junction');
  linkNodeModules(main, dir);
  const coreLink = join(dir, rel, 'node_modules', '@scope', 'core');
  const bootstrap = mock(async () => ({ action: 'linked', dirs: linkNodeModules(main, dir) }));
  return { base, mainCore, worktreeCore, dir, coreLink, bootstrap };
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

  test('re-links when a package node_modules is still one junction to the main tree', async () => {
    // TempoRaid 1420: パッケージ全体の junction が workspace リンクをメイン側へ向けていた。
    // .worktrees の親として一時 main だけが導出されるよう、実リポジトリの外へ隔離する。
    const base = fs.mkdtempSync(join(os.tmpdir(), 'preflight-pkg-'));
    try {
      const mainNm = join(base, 'main', 'node_modules');
      const mainPkgNm = join(base, 'main', 'apps', 'server', 'node_modules');
      fs.mkdirSync(join(mainNm, '.bin'), { recursive: true });
      fs.mkdirSync(join(mainPkgNm, 'zod'), { recursive: true });
      const dir = join(base, 'main', '.worktrees', 'task-1534-pkg-junction');
      fs.mkdirSync(join(dir, 'apps', 'server'), { recursive: true });
      const mainCore = join(base, 'main', 'packages', 'core');
      const worktreeCore = join(dir, 'packages', 'core');
      fs.mkdirSync(mainCore, { recursive: true });
      fs.mkdirSync(worktreeCore, { recursive: true });
      fs.mkdirSync(join(mainPkgNm, '@scope'), { recursive: true });
      fs.symlinkSync(mainCore, join(mainPkgNm, '@scope', 'core'), 'junction');
      fs.writeFileSync(join(dir, 'package.json'), '{}');
      const nm = join(dir, 'node_modules');
      makeManagedRoot(nm);
      fs.mkdirSync(join(nm, '.pnpm-task-run-state-v1'));
      fs.symlinkSync(join(mainNm, '.bin'), join(nm, '.bin'), 'junction');
      fs.symlinkSync(mainPkgNm, join(dir, 'apps', 'server', 'node_modules'), 'junction');
      const bootstrap = mock(async () => ({
        action: 'linked',
        dirs: linkNodeModules(join(base, 'main'), dir),
      }));

      await preflightWorktree(dir, { bootstrap });

      expect(bootstrap).toHaveBeenCalledTimes(1);
      expect(fs.lstatSync(join(dir, 'apps', 'server', 'node_modules')).isSymbolicLink()).toBe(
        false,
      );
      expect(fs.realpathSync(join(dir, 'apps', 'server', 'node_modules', '@scope', 'core'))).toBe(
        fs.realpathSync(worktreeCore),
      );
      expect(fs.existsSync(join(mainPkgNm, 'zod'))).toBe(true);
      expect(fs.existsSync(mainCore)).toBe(true);
    } finally {
      removeTree(base);
    }
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

  test.each([false, true])(
    'メイン側スコープもリンクの場合に共有スコープを修復する（package=%s）',
    async (packageLevel) => {
      const fixture = makeWorkspaceFixture(packageLevel);
      try {
        const rel = packageLevel ? 'apps/server' : '';
        const mainNm = join(fixture.base, 'main', rel, 'node_modules');
        const mainScope = join(mainNm, '@scope');
        const backing = join(mainNm, '.scope-store');
        fs.renameSync(mainScope, backing);
        fs.symlinkSync(backing, mainScope, 'junction');
        const worktreeScope = join(fixture.dir, rel, 'node_modules', '@scope');
        removeTree(worktreeScope);
        fs.symlinkSync(mainScope, worktreeScope, 'junction');

        await preflightWorktree(fixture.dir, {
          bootstrap: fixture.bootstrap,
          wrapper: async () => undefined,
        });

        expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
        expect(fs.lstatSync(worktreeScope).isDirectory()).toBe(true);
        expect(fs.realpathSync(fixture.coreLink)).toBe(fs.realpathSync(fixture.worktreeCore));
        expect(fs.readFileSync(join(fixture.mainCore, 'index.ts'), 'utf8')).toBe('main');
        await preflightWorktree(fixture.dir, {
          bootstrap: fixture.bootstrap,
          wrapper: async () => undefined,
        });
        expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
      } finally {
        removeTree(fixture.base);
      }
    },
  );

  test('ルートの workspace リンクがメインを指していたらプリフライトで修復する', async () => {
    const fixture = makeWorkspaceFixture(false);
    try {
      removeTree(fixture.coreLink);
      fs.symlinkSync(fixture.mainCore, fixture.coreLink, 'junction');

      await preflightWorktree(fixture.dir, {
        bootstrap: fixture.bootstrap,
        wrapper: async () => undefined,
      });

      expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
      expect(fs.realpathSync(fixture.coreLink)).toBe(fs.realpathSync(fixture.worktreeCore));
      expect(fs.readFileSync(join(fixture.mainCore, 'index.ts'), 'utf8')).toBe('main');
    } finally {
      removeTree(fixture.base);
    }
  });

  test('リンク先の workspace が消失したらプリフライトでメイン側へ復旧する', async () => {
    const fixture = makeWorkspaceFixture(true);
    try {
      removeTree(fixture.worktreeCore);
      expect(fs.existsSync(fixture.coreLink)).toBe(false);

      await preflightWorktree(fixture.dir, {
        bootstrap: fixture.bootstrap,
        wrapper: async () => undefined,
      });

      expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
      expect(fs.realpathSync(fixture.coreLink)).toBe(fs.realpathSync(fixture.mainCore));
      expect(fs.readFileSync(join(fixture.coreLink, 'index.ts'), 'utf8')).toBe('main');
    } finally {
      removeTree(fixture.base);
    }
  });

  test('解除直後の中断でパッケージの node_modules が欠如してもプリフライトで再作成する', async () => {
    const fixture = makeWorkspaceFixture(true);
    try {
      const packageModules = join(fixture.dir, 'apps', 'server', 'node_modules');
      removeTree(packageModules);
      expect(fs.existsSync(join(fixture.dir, 'apps', 'server'))).toBe(true);

      await preflightWorktree(fixture.dir, {
        bootstrap: fixture.bootstrap,
        wrapper: async () => undefined,
      });

      expect(fixture.bootstrap).toHaveBeenCalledTimes(1);
      expect(fs.lstatSync(packageModules).isSymbolicLink()).toBe(false);
      expect(fs.realpathSync(fixture.coreLink)).toBe(fs.realpathSync(fixture.worktreeCore));
      expect(fs.readFileSync(join(fixture.mainCore, 'index.ts'), 'utf8')).toBe('main');
    } finally {
      removeTree(fixture.base);
    }
  });
});
