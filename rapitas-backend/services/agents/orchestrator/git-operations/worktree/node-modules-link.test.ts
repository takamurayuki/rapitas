/**
 * node-modules-link.test
 *
 * Driven against real directories and real junctions: link handling is exactly
 * what a mocked fs would paper over, and the Windows junction behaviour here is
 * load-bearing (lstat reports a junction as a symbolic link; rmSync cannot
 * clear one and recursing through it would delete the shared tree).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverInstalledDirs,
  holdsRealInstall,
  linkNodeModules,
  worktreeHasUsableModules,
} from './node-modules-link';

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
  // Clear junctions first: a recursive remove would descend through them.
  for (const rel of ['', 'apps/web', 'apps/server']) {
    const link = path.join(worktree, rel, 'node_modules');
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
      /* not present */
    }
  }
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

  it('accepts one holding packages', () => {
    install(worktree, ['.vite', 'zod']);
    expect(holdsRealInstall(worktree)).toBe(true);
  });

  it('accepts a pnpm store or a .bin even though both are dot-entries', () => {
    for (const marker of ['.pnpm', '.bin']) {
      fs.rmSync(path.join(worktree, 'node_modules'), { recursive: true, force: true });
      install(worktree, [marker]);
      expect(holdsRealInstall(worktree)).toBe(true);
    }
  });

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

describe('linkNodeModules', () => {
  it('links the root and each package dir', () => {
    install(root);
    install(path.join(root, 'apps/web'));

    const linked = linkNodeModules(root, worktree).sort();

    expect(linked).toEqual(['', 'apps/web']);
    expect(linkState()).toBe(`link->${path.join(root, 'node_modules')}`);
    expect(linkState('apps/web')).toBe(`link->${path.join(root, 'apps', 'web', 'node_modules')}`);
    // The binaries every lint/test/build command resolves through.
    expect(fs.existsSync(path.join(worktree, 'node_modules', '.bin'))).toBe(true);
  });

  it('is idempotent', () => {
    install(root);
    linkNodeModules(root, worktree);
    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe(`link->${path.join(root, 'node_modules')}`);
  });

  it('replaces a cache-only node_modules instead of skipping it forever', () => {
    install(root);
    install(worktree, ['.vite']);
    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe(`link->${path.join(root, 'node_modules')}`);
  });

  it('never destroys a real install in the worktree', () => {
    install(root);
    install(worktree, ['zod']);
    expect(linkNodeModules(root, worktree)).toEqual([]);
    expect(linkState()).toBe('real');
    expect(fs.existsSync(path.join(worktree, 'node_modules', 'zod'))).toBe(true);
  });

  it('keeps a link that points elsewhere but still resolves', () => {
    // A project prepared by an earlier revision is linked to a different tree.
    // Re-pointing a WORKING link would strand the agent mid-task for no gain.
    install(root);
    const other = path.join(base, 'other-tree');
    install(other);
    fs.symlinkSync(
      path.join(other, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'junction',
    );

    expect(linkNodeModules(root, worktree)).toEqual(['']);
    expect(linkState()).toBe(`link->${path.join(other, 'node_modules')}`);
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
    expect(linkState()).toBe(`link->${path.join(root, 'node_modules')}`);
  });
});

describe('worktreeHasUsableModules', () => {
  it('is true for a real install', () => {
    install(worktree);
    expect(worktreeHasUsableModules(worktree)).toBe(true);
  });

  it('is true for a link that still resolves', () => {
    install(root);
    linkNodeModules(root, worktree);
    expect(worktreeHasUsableModules(worktree)).toBe(true);
  });

  it('is false for nothing, for a cache-only directory, and for a dangling link', () => {
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
