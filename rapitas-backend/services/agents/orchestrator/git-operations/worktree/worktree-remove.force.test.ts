/**
 * worktree-remove.force.test
 *
 * Real-git check that removeWorktree's forceRemove mode (used by disposable
 * comparison-cell worktrees) deletes a dirty worktree and its branch, while the
 * default mode still refuses to destroy uncommitted work.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { linkNodeModules } from './node-modules-link';
import { detachLinksSafely } from './node-modules-root-entries';
import { tmpdir } from 'os';
import { join } from 'path';
import { removeWorktree } from './worktree-remove';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let repo: string;
let wt: string;
const BRANCH = 'shadow-cmp-test-branch';

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-force-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'tracked.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  wt = join(repo, '.worktrees', 'wt-cell');
  git(repo, 'worktree', 'add', '-q', '-b', BRANCH, wt);
  // Agent behaviour: modify a tracked file and add an untracked one.
  writeFileSync(join(wt, 'tracked.txt'), 'changed\n');
  writeFileSync(join(wt, 'new.txt'), 'untracked\n');
});

afterEach(() => {
  if (!detachLinksSafely(root)) throw new Error('テスト用ディレクトリのリンク解除に失敗');
  rmSync(root, { recursive: true, force: true });
});

describe('removeWorktree forceRemove', () => {
  test('既定では dirty な worktree の削除を拒否する（回帰）', async () => {
    const removed = await removeWorktree(repo, wt, true);
    expect(removed).toBe(false);
    expect(existsSync(wt)).toBe(true);
  });

  test('forceRemove=true は dirty でも worktree とブランチを残さない', async () => {
    const removed = await removeWorktree(repo, wt, true, undefined, true);
    expect(removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(git(repo, 'worktree', 'list')).not.toContain('wt-cell');
    expect(git(repo, 'branch', '--list', BRANCH)).toBe('');
  });

  test('forceRemove=true は commit 済みで未 push のブランチも削除する', async () => {
    git(wt, 'add', '-A');
    git(wt, 'commit', '-q', '-m', 'agent commit');
    writeFileSync(join(wt, 'late.txt'), 'dirty again\n');
    const removed = await removeWorktree(repo, wt, true, undefined, true);
    expect(removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(git(repo, 'branch', '--list', BRANCH)).toBe('');
  });
});

describe('removeWorktree with a managed root node_modules', () => {
  test('メイン側の node_modules の全エントリを残して worktree を消す（teardown スクリプト無し）', async () => {
    const main = join(root, 'main-tree');
    mkdirSync(join(main, 'node_modules', '.pnpm', 'pkg'), { recursive: true });
    mkdirSync(join(main, 'node_modules', 'zod'), { recursive: true });
    writeFileSync(join(main, 'node_modules', 'zod', 'index.js'), 'z');
    writeFileSync(join(main, 'node_modules', '.pnpm', 'pkg', 'index.js'), 'p');
    writeFileSync(join(main, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
    expect(linkNodeModules(main, wt)).toEqual(['']);

    const removed = await removeWorktree(repo, wt, true, undefined, true);

    expect(removed).toBe(true);
    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(main, 'node_modules', 'zod', 'index.js'))).toBe(true);
    expect(existsSync(join(main, 'node_modules', '.pnpm', 'pkg', 'index.js'))).toBe(true);
    expect(existsSync(join(main, 'node_modules', '.modules.yaml'))).toBe(true);
  });

  test('ワークスペースリンクを持つ worktree を消しても、メイン側の node_modules と packages/core が残る', async () => {
    const main = join(root, 'main-tree');
    const mainNm = join(main, 'apps', 'server', 'node_modules');
    mkdirSync(join(main, 'packages', 'core'), { recursive: true });
    writeFileSync(join(main, 'packages', 'core', 'index.ts'), 'main core');
    mkdirSync(join(mainNm, 'zod'), { recursive: true });
    writeFileSync(join(mainNm, 'zod', 'index.js'), 'z');
    mkdirSync(join(mainNm, '@scope'), { recursive: true });
    try {
      fs.symlinkSync('../../../../packages/core', join(mainNm, '@scope', 'core'), 'dir');
    } catch {
      // Windows without symlink privilege: a junction resolves to the same place.
      fs.symlinkSync(join(main, 'packages', 'core'), join(mainNm, '@scope', 'core'), 'junction');
    }
    mkdirSync(join(wt, 'packages', 'core'), { recursive: true });
    writeFileSync(join(wt, 'packages', 'core', 'index.ts'), 'wt core');
    expect(linkNodeModules(main, wt)).toEqual(['apps/server']);
    expect(realpathSync(join(wt, 'apps', 'server', 'node_modules', '@scope', 'core'))).toBe(
      realpathSync(join(wt, 'packages', 'core')),
    );

    expect(await removeWorktree(repo, wt, true, undefined, true)).toBe(true);

    expect(existsSync(wt)).toBe(false);
    expect(existsSync(join(main, 'packages', 'core', 'index.ts'))).toBe(true);
    expect(existsSync(join(mainNm, 'zod', 'index.js'))).toBe(true);
    expect(existsSync(join(mainNm, '@scope', 'core', 'index.ts'))).toBe(true);
  });

  test('解除失敗後もマーカーを維持し、再試行時に残存リンクの削除を拒否する', async () => {
    const main = join(root, 'main-tree');
    mkdirSync(join(main, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(main, 'node_modules', 'pkg', 'index.js'), 'keep');
    writeFileSync(join(main, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
    expect(linkNodeModules(main, wt)).toEqual(['']);
    const link = join(wt, 'node_modules', 'pkg');
    const originalUnlink = fs.unlinkSync;
    const originalRmdir = fs.rmdirSync;
    const failBusy = () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    };
    const unlink = spyOn(fs, 'unlinkSync').mockImplementation((path) =>
      String(path) === link ? failBusy() : originalUnlink(path),
    );
    const rmdir = spyOn(fs, 'rmdirSync').mockImplementation((path, options) =>
      String(path) === link ? failBusy() : originalRmdir(path, options),
    );
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await removeWorktree(repo, wt, false, undefined, true)).toBe(false);
        expect(existsSync(join(wt, 'node_modules', '.rapitas-linked-root'))).toBe(true);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      }
      expect(existsSync(join(main, 'node_modules', 'pkg', 'index.js'))).toBe(true);
      expect(existsSync(join(main, 'node_modules', '.modules.yaml'))).toBe(true);
    } finally {
      unlink.mockRestore();
      rmdir.mockRestore();
      try {
        originalUnlink(link);
      } catch {
        if (existsSync(link)) originalRmdir(link);
      }
    }
  });

  test.each(['事前', 'git失敗後'])(
    '%s に作られた深いリンクを解除してから fs フォールバックを実行する',
    async (timing) => {
      const main = join(root, 'main-tree');
      const packageModules = join(main, 'apps', 'web', 'node_modules');
      mkdirSync(join(main, 'node_modules', '.pnpm', 'pkg'), { recursive: true });
      mkdirSync(join(packageModules, 'pkg'), { recursive: true });
      writeFileSync(join(packageModules, 'pkg', 'index.js'), 'package keep');
      writeFileSync(join(main, 'node_modules', '.pnpm', 'pkg', 'index.js'), 'keep');
      writeFileSync(join(main, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
      expect(linkNodeModules(main, wt)).toEqual(['', 'apps/web']);
      const packageLink = join(wt, 'apps', 'web', 'node_modules');
      const cache = join(wt, 'node_modules', '.cache', 'a', 'b', 'c', 'd');
      mkdirSync(cache, { recursive: true });
      const deepLink = join(cache, 'deep-link');
      if (timing === '事前')
        fs.symlinkSync(join(main, 'node_modules', '.pnpm'), deepLink, 'junction');
      git(repo, 'worktree', 'lock', wt);
      const originalRm = fsPromises.rm;
      const originalStat = fsPromises.stat;
      const stat = spyOn(fsPromises, 'stat').mockImplementation(async (...args) => {
        if (timing === 'git失敗後' && String(args[0]) === join(wt, '.git')) {
          mkdirSync(cache, { recursive: true });
          fs.symlinkSync(join(main, 'node_modules', '.pnpm'), deepLink, 'junction');
        }
        return originalStat(...args);
      });
      let linkedBeforeFallback: boolean | undefined;
      let packageLinkedBeforeFallback: boolean | undefined;
      const rm = spyOn(fsPromises, 'rm').mockImplementation(async (path, options) => {
        if (String(path) === wt) {
          linkedBeforeFallback = existsSync(deepLink);
          // パッケージ配下も実ディレクトリ＋エントリ単位リンクなので、エントリで確かめる。
          packageLinkedBeforeFallback = existsSync(join(packageLink, 'pkg'));
        }
        return originalRm(path, options);
      });
      try {
        expect(await removeWorktree(repo, wt, false, undefined, true)).toBe(true);
        expect(linkedBeforeFallback).toBe(false);
        expect(packageLinkedBeforeFallback).toBe(false);
        expect(existsSync(wt)).toBe(false);
        expect(existsSync(join(main, 'node_modules', '.pnpm', 'pkg', 'index.js'))).toBe(true);
        expect(existsSync(join(main, 'node_modules', '.modules.yaml'))).toBe(true);
        expect(existsSync(join(packageModules, 'pkg', 'index.js'))).toBe(true);
      } finally {
        rm.mockRestore();
        stat.mockRestore();
      }
    },
  );
});
