/**
 * node-modules-link.test
 *
 * Driven against real directories and real junctions: link handling is exactly
 * what a mocked fs would paper over, and the Windows junction behaviour here is
 * load-bearing (lstat reports a junction as a symbolic link; rmSync cannot
 * clear one and recursing through it would delete the shared tree).
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverInstalledDirs,
  holdsRealInstall,
  inspectLinkPath,
  linkNodeModules,
  worktreeHasUsableModules,
} from './node-modules-link';
import { linkRootEntries, unlinkRootEntries } from './node-modules-root-entries';

let base: string;
let root: string;
let worktree: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-link-'));
  root = path.join(base, 'myapp');
  worktree = path.join(root, '.worktrees', 'task-1153-c3a5cb1f');
  fs.mkdirSync(worktree, { recursive: true });
});

afterEach(() => {
  // 一時領域もリンクをたどらず、深いリンクを先に解除する。
  const detach = (entry: string): void => {
    const stat = fs.lstatSync(entry);
    if (stat.isSymbolicLink()) {
      try {
        fs.unlinkSync(entry);
      } catch {
        fs.rmdirSync(entry);
      }
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(entry)) detach(path.join(entry, name));
    }
  };
  detach(base);
  fs.rmSync(base, { recursive: true, force: true });
});

/** Create node_modules in `dir` holding the given top-level entries. */
const install = (dir: string, entries: string[] = ['.bin', 'zod']) => {
  for (const e of entries) fs.mkdirSync(path.join(dir, 'node_modules', e), { recursive: true });
  if (entries.length === 0) fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
};

const linkState = (rel = '') => {
  const p = path.join(worktree, rel, 'node_modules');
  try {
    return fs.lstatSync(p).isSymbolicLink() ? `link->${fs.readlinkSync(p)}` : 'real';
  } catch {
    return 'absent';
  }
};

describe('holdsRealInstall', () => {
  it('rejects a node_modules holding only tool caches', () => {
    // Exactly what task 1153's worktree had after Vite ran once.
    install(worktree, ['.vite', '.vite-temp']);
    expect(holdsRealInstall(worktree)).toBe(false);
  });

  // Measured 2026-10-13 on ContextFlow task #1217. Its
  // `apps/web/node_modules` held @types, next, next-auth, react, react-dom,
  // vitest and zod — and NO `.bin`. Package directories alone were read as a
  // genuine install, so linkNodeModules skipped the directory, and `next dev`
  // then failed with "next not found" even though the next package was sitting
  // right there. runtime-smoke could not run, and the task bounced for an
  // environment reason rather than anything it had done. A tree that cannot
  // execute a binary is a PARTIAL install, not a real one.
  it('rejects packages without any install marker (a partial install)', () => {
    install(worktree, ['@types', 'next', 'react', 'vitest', 'zod']);
    expect(holdsRealInstall(worktree)).toBe(false);
  });

  it('rejects packages alongside a tool cache but no marker', () => {
    install(worktree, ['.vite', 'zod']);
    expect(holdsRealInstall(worktree)).toBe(false);
  });

  it('accepts a .bin even though it is a dot-entry', () => {
    install(worktree, ['.bin']);
    expect(holdsRealInstall(worktree)).toBe(true);
  });

  // Measured 2026-10-13 on ContextFlow task #1215, AFTER the first version of
  // this rule shipped. Its worktree root node_modules held exactly one entry,
  // `.pnpm`, and nothing else; `pnpm dev` still failed with "'next' は、内部
  // コマンドまたは外部コマンド... として認識されていません" and pnpm itself
  // warned "Local package.json exists, but node_modules missing". runtime-smoke
  // then reported `unverifiable; completion withheld` and the task could not
  // finish.
  //
  // `.pnpm` is the virtual store pnpm creates while it works, not a record that
  // it finished — the install that completes writes `.modules.yaml` and `.bin`
  // (both present in the project root this worktree should have linked to). The
  // first version of this rule accepted `.pnpm` as completion evidence, which
  // made this shape WORSE than the any-non-dot-entry rule it replaced: under
  // the old rule `.pnpm` was a dot-entry and the tree got relinked.
  it('rejects a lone .pnpm store (pnpm started but never finished)', () => {
    install(worktree, ['.pnpm']);
    expect(holdsRealInstall(worktree)).toBe(false);
  });

  // ContextFlow task #1217's worktree root, measured the same day: a `.pnpm`
  // store plus package directories, still no `.bin` and no `.modules.yaml`, and
  // `next dev` still could not start. Packages that no binary can be launched
  // from are the same partial tree as the case above.
  it('rejects a .pnpm store alongside packages but no .bin or .modules.yaml', () => {
    install(worktree, ['.pnpm', '@types', 'eslint', 'typescript']);
    expect(holdsRealInstall(worktree)).toBe(false);
  });

  // The real shapes measured in ContextFlow, so the rule is pinned to what
  // actual installers produce rather than to invented fixtures.
  for (const [label, entries] of [
    ['pnpm project root', ['.bin', '.cache', '.pnpm', '.modules.yaml', 'eslint', 'typescript']],
    ['pnpm workspace package', ['.bin', '@types', 'next', 'react', 'zod']],
    ['package whose deps ship a binary', ['.bin', '.vite', 'vitest', 'zod']],
    ['npm hoisted install', ['.package-lock.json', 'react']],
  ] as const) {
    it(`accepts a complete install: ${label}`, () => {
      fs.rmSync(path.join(worktree, 'node_modules'), { recursive: true, force: true });
      install(worktree, [...entries]);
      expect(holdsRealInstall(worktree)).toBe(true);
    });
  }

  it('rejects an absent or empty node_modules', () => {
    expect(holdsRealInstall(worktree)).toBe(false);
    install(worktree, []);
    expect(holdsRealInstall(worktree)).toBe(false);
  });
});

describe('discoverInstalledDirs', () => {
  it('reports the root and every package dir the install populated', () => {
    install(root);
    install(path.join(root, 'apps/web'));
    install(path.join(root, 'packages/core'));
    expect(discoverInstalledDirs(root).sort()).toEqual(['', 'apps/web', 'packages/core']);
  });

  it('reports nothing when the project is not installed', () => {
    fs.mkdirSync(path.join(root, 'apps/web'), { recursive: true });
    expect(discoverInstalledDirs(root)).toEqual([]);
  });
});

describe('inspectLinkPath', () => {
  it.each([
    ['未作成', 'absent'],
    ['空ディレクトリ', 'real'],
    ['実インストール', 'real'],
    ['管理下ルート', 'managed'],
    ['旧junction', 'link'],
    ['切れたjunction', 'link'],
  ] as const)('%s を %s と判定する', (kind, expected) => {
    const modules = path.join(worktree, 'node_modules');
    if (kind === '空ディレクトリ') install(worktree, []);
    if (kind === '実インストール') install(worktree);
    if (kind === '管理下ルート') {
      install(root);
      linkNodeModules(root, worktree);
    }
    if (kind === '旧junction' || kind === '切れたjunction') {
      install(root);
      fs.symlinkSync(path.join(root, 'node_modules'), modules, 'junction');
      if (kind === '切れたjunction') {
        fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
      }
    }
    expect(inspectLinkPath(modules)).toBe(expected);
  });
});

describe('linkNodeModules', () => {
  it('links the root and each package dir', () => {
    install(root);
    install(path.join(root, 'apps/web'));

    const linked = linkNodeModules(root, worktree).sort();

    expect(linked).toEqual(['', 'apps/web']);
    expect(linkState()).toBe('real');
    expect(linkState('apps/web')).toBe('real');
    // The binaries every lint/test/build command resolves through.
    expect(fs.existsSync(path.join(worktree, 'node_modules', '.bin'))).toBe(true);
  });

  it('is idempotent', () => {
    install(root);
    linkNodeModules(root, worktree);
    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe('real');
  });

  it('replaces a cache-only node_modules instead of skipping it forever', () => {
    install(root);
    install(worktree, ['.vite']);
    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe('real');
    expect(fs.existsSync(path.join(worktree, 'node_modules', '.vite'))).toBe(false);
    expect(fs.lstatSync(path.join(worktree, 'node_modules', 'zod')).isSymbolicLink()).toBe(true);
  });

  it('never destroys a real install in the worktree', () => {
    install(root);
    install(worktree, ['.bin', 'zod']);
    expect(linkNodeModules(root, worktree)).toEqual([]);
    expect(linkState()).toBe('real');
    expect(fs.existsSync(path.join(worktree, 'node_modules', 'zod'))).toBe(true);
  });

  // The ContextFlow #1217 shape, measured 2026-10-13: the worktree's
  // apps/web/node_modules held seven package directories and no `.bin`, so the
  // link was skipped and `next` could not be executed from it. Replacing the
  // partial tree with the link is what makes the binary resolvable.
  it('replaces a partial workspace install that cannot run a binary', () => {
    install(root);
    install(path.join(root, 'apps/web'), ['.bin', 'next', 'react']);
    install(path.join(worktree, 'apps/web'), ['next', 'react', 'zod']);

    const linked = linkNodeModules(root, worktree).sort();

    expect(linked).toEqual(['', 'apps/web']);
    expect(linkState('apps/web')).toBe('real');
    expect(fs.existsSync(path.join(worktree, 'apps/web', 'node_modules', '.bin'))).toBe(true);
  });

  it('replaces a whole-directory root link so pnpm 12 accepts the root', () => {
    install(root);
    const other = path.join(base, 'other-tree');
    install(other);
    fs.symlinkSync(
      path.join(other, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'junction',
    );

    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe('real');
    // The old link target is untouched.
    expect(fs.existsSync(path.join(other, 'node_modules', 'zod'))).toBe(true);
  });

  it('keeps a package-level link that points elsewhere but still resolves', () => {
    // A project prepared by an earlier revision is linked to a different tree.
    // Re-pointing a WORKING link would strand the agent mid-task for no gain.
    install(root);
    install(path.join(root, 'apps/web'));
    const other = path.join(base, 'other-tree');
    install(other);
    fs.mkdirSync(path.join(worktree, 'apps/web'), { recursive: true });
    fs.symlinkSync(
      path.join(other, 'node_modules'),
      path.join(worktree, 'apps/web', 'node_modules'),
      'junction',
    );

    linkNodeModules(root, worktree);
    expect(linkState('apps/web')).toBe(`link->${path.join(other, 'node_modules')}`);
  });

  it('replaces a dangling link', () => {
    install(root);
    const gone = path.join(base, 'deleted-tree');
    install(gone);
    fs.symlinkSync(
      path.join(gone, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'junction',
    );
    fs.rmSync(gone, { recursive: true, force: true });

    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe('real');
  });

  it.each(['', 'apps/web'])('%s のキャッシュ内の深いjunctionを再帰削除前に解除する', (rel) => {
    install(root);
    const source = path.join(root, rel);
    if (rel) install(source);
    const modules = path.join(worktree, rel, 'node_modules');
    const cache = path.join(modules, '.vite', 'a', 'b', 'c', 'd');
    fs.mkdirSync(cache, { recursive: true });
    const linkedCache = path.join(cache, 'shared');
    const target = path.join(source, 'node_modules', 'zod');
    fs.writeFileSync(path.join(target, 'keep.txt'), '共有依存');
    fs.symlinkSync(target, linkedCache, 'junction');
    const detach = spyOn(fs, 'unlinkSync');
    try {
      expect(linkNodeModules(root, worktree).sort()).toEqual(rel ? ['', rel] : ['']);
      expect(detach).toHaveBeenCalledWith(linkedCache);
      expect(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('共有依存');
    } finally {
      detach.mockRestore();
    }
  });

  it('パッケージ配下の管理済み実ディレクトリを再同期し共有先を壊さない', () => {
    install(root);
    const source = path.join(root, 'apps/web', 'node_modules');
    install(path.join(root, 'apps/web'));
    fs.writeFileSync(path.join(source, '.modules.yaml'), 'layoutVersion: 5\n');
    fs.writeFileSync(path.join(source, 'zod', 'keep.txt'), '共有依存');
    const modules = path.join(worktree, 'apps/web', 'node_modules');
    expect(linkRootEntries(source, modules)).toBe(true);

    expect(linkNodeModules(root, worktree).sort()).toEqual(['', 'apps/web']);
    expect(fs.lstatSync(modules).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(path.join(modules, 'zod')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(source, '.modules.yaml'), 'utf8')).toBe('layoutVersion: 5\n');
    expect(fs.readFileSync(path.join(source, 'zod', 'keep.txt'), 'utf8')).toBe('共有依存');
  });
});

describe('linkNodeModules root shape (pnpm 12)', () => {
  const seedMain = () => {
    install(root, ['.pnpm', '.bin', 'zod', '@types']);
    fs.writeFileSync(path.join(root, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n');
    fs.writeFileSync(path.join(root, 'node_modules', '.pnpm', 'keep.txt'), 'x');
  };
  const wtNm = () => path.join(worktree, 'node_modules');

  it('makes the root a real directory, directories junctions, files copies', () => {
    seedMain();
    install(path.join(root, 'apps/web'));

    expect(linkNodeModules(root, worktree).sort()).toEqual(['', 'apps/web']);

    expect(fs.lstatSync(wtNm()).isDirectory()).toBe(true);
    expect(fs.lstatSync(wtNm()).isSymbolicLink()).toBe(false);
    for (const dir of ['.pnpm', '.bin', 'zod', '@types']) {
      expect(fs.lstatSync(path.join(wtNm(), dir)).isSymbolicLink()).toBe(true);
    }
    const copy = fs.lstatSync(path.join(wtNm(), '.modules.yaml'));
    expect(copy.isFile() && !copy.isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(wtNm(), '.modules.yaml'), 'utf8')).toBe('layoutVersion: 5\n');
    // Package-level node_modules are real directories of links too, so a
    // workspace link can point at the worktree.
    expect(linkState('apps/web')).toBe('real');
    expect(fs.existsSync(path.join(wtNm(), '.pnpm', 'keep.txt'))).toBe(true);
  });

  it('follows the main checkout on a rerun: adds new entries, drops vanished links', () => {
    seedMain();
    linkNodeModules(root, worktree);
    fs.mkdirSync(path.join(root, 'node_modules', 'react'));
    fs.rmSync(path.join(root, 'node_modules', 'zod'), { recursive: true });

    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(fs.lstatSync(path.join(wtNm(), 'react')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(wtNm(), 'zod'))).toBe(false);
  });

  it('is not mistaken for a real install because of the copied .modules.yaml', () => {
    seedMain();
    linkNodeModules(root, worktree);
    expect(holdsRealInstall(worktree)).toBe(false);
    expect(holdsRealInstall(root)).toBe(true);
  });

  it('unlinking the root entries leaves every main entry in place', () => {
    seedMain();
    linkNodeModules(root, worktree);
    expect(unlinkRootEntries(wtNm())).toBe(true);
    expect(fs.existsSync(wtNm())).toBe(false);
    for (const e of ['.pnpm', '.bin', 'zod', '@types', '.modules.yaml']) {
      expect(fs.existsSync(path.join(root, 'node_modules', e))).toBe(true);
    }
    expect(fs.existsSync(path.join(root, 'node_modules', '.pnpm', 'keep.txt'))).toBe(true);
  });

  it('keeps a directory the worktree owns and still spares the main tree', () => {
    seedMain();
    linkNodeModules(root, worktree);
    fs.mkdirSync(path.join(wtNm(), '.vite'));
    expect(unlinkRootEntries(wtNm())).toBe(true);
    expect(fs.existsSync(path.join(root, 'node_modules', '.pnpm', 'keep.txt'))).toBe(true);
    expect(fs.existsSync(path.join(wtNm(), '.vite'))).toBe(true);
  });
});

describe('worktreeHasUsableModules', () => {
  it('is true for a managed root whose links resolve, false once one dangles', () => {
    install(root, ['.pnpm', '.bin', 'zod']);
    linkNodeModules(root, worktree);
    expect(worktreeHasUsableModules(worktree)).toBe(true);
    fs.rmSync(path.join(root, 'node_modules', '.pnpm'), { recursive: true });
    expect(worktreeHasUsableModules(worktree)).toBe(false);
  });

  it.each(['実インストール', '生存する旧junction'])('%s は利用可能と判定する', (kind) => {
    if (kind === '実インストール') {
      install(worktree);
    } else {
      install(root);
      fs.symlinkSync(
        path.join(root, 'node_modules'),
        path.join(worktree, 'node_modules'),
        'junction',
      );
    }
    expect(worktreeHasUsableModules(worktree)).toBe(true);
  });

  it('is false for nothing, for a cache-only directory, and for a dangling link', () => {
    expect(worktreeHasUsableModules(worktree)).toBe(false);

    install(worktree, []);
    expect(worktreeHasUsableModules(worktree)).toBe(false);

    install(worktree, ['.vite']);
    expect(worktreeHasUsableModules(worktree)).toBe(false);
    fs.rmSync(path.join(worktree, 'node_modules'), { recursive: true, force: true });

    const gone = path.join(base, 'gone');
    install(gone);
    fs.symlinkSync(
      path.join(gone, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'junction',
    );
    fs.rmSync(gone, { recursive: true, force: true });
    expect(worktreeHasUsableModules(worktree)).toBe(false);
  });
});
