/**
 * project-dependency-bootstrap.test
 *
 * Exercised against real temp directories rather than a mocked fs: what is
 * under test is which node_modules become reachable from a worktree and when an
 * install is skipped, and junction/link handling is exactly what a mock would
 * paper over. The install itself is driven through a stub command so no network
 * or package manager is needed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SIDECAR_DIR,
  bootstrapProjectDependencies,
  collectManifests,
  fingerprintManifests,
  projectRootOf,
  resolveInstallCommand,
} from './project-dependency-bootstrap';

let base: string;
let root: string;
let worktree: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-boot-'));
  root = path.join(base, 'myapp');
  worktree = path.join(root, '.worktrees', 'task-1153-c3a5cb1f');
  fs.mkdirSync(worktree, { recursive: true });
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

/** Write a file, creating parents. */
const put = (dir: string, rel: string, body: string) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
};

describe('projectRootOf', () => {
  it('returns the project that owns a worktree', () => {
    expect(projectRootOf(worktree)).toBe(root);
  });

  it('returns the path itself when it is not a worktree', () => {
    expect(projectRootOf(root)).toBe(root);
  });

  it('handles a posix-separator path on any platform', () => {
    expect(projectRootOf('C:/Projects/temporaid/.worktrees/task-1153-c3a5cb1f')).toBe(
      'C:/Projects/temporaid',
    );
  });
});

describe('resolveInstallCommand', () => {
  it('follows the lockfile when one exists', () => {
    put(worktree, 'package.json', '{}');
    put(worktree, 'pnpm-lock.yaml', '');
    expect(resolveInstallCommand(worktree)).toBe('pnpm install');
  });

  it('falls back to the packageManager field before any lockfile exists', () => {
    put(worktree, 'package.json', JSON.stringify({ packageManager: 'yarn@4.5.0' }));
    expect(resolveInstallCommand(worktree)).toBe('yarn install');
  });

  it('infers pnpm from a workspace file when nothing else says', () => {
    // The first setup of a generated monorepo: no lockfile yet, which is
    // precisely when this runs.
    put(worktree, 'package.json', '{}');
    put(worktree, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    expect(resolveInstallCommand(worktree)).toBe('pnpm install');
  });

  it('defaults to npm for a plain single-package project', () => {
    put(worktree, 'package.json', '{}');
    expect(resolveInstallCommand(worktree)).toBe('npm install');
  });

  it('ignores an unreadable manifest instead of throwing', () => {
    put(worktree, 'package.json', '{ this is not json');
    expect(resolveInstallCommand(worktree)).toBe('npm install');
  });
});

describe('collectManifests', () => {
  it('finds root files and every workspace package.json', () => {
    put(worktree, 'package.json', '{}');
    put(worktree, 'pnpm-workspace.yaml', '');
    put(worktree, 'apps/web/package.json', '{}');
    put(worktree, 'apps/server/package.json', '{}');
    put(worktree, 'packages/core/package.json', '{}');
    expect(collectManifests(worktree)).toEqual([
      'apps/server/package.json',
      'apps/web/package.json',
      'package.json',
      'packages/core/package.json',
      'pnpm-workspace.yaml',
    ]);
  });

  it('never descends into node_modules', () => {
    put(worktree, 'package.json', '{}');
    put(worktree, 'node_modules/zod/package.json', '{}');
    expect(collectManifests(worktree)).toEqual(['package.json']);
  });

  it('returns nothing for a repo that only has docs', () => {
    // ContextFlow's state when task 1152 blocked: docs + .claude only.
    put(worktree, 'docs/design.md', '# design');
    put(worktree, '.claude/CLAUDE.md', '# guide');
    expect(collectManifests(worktree)).toEqual([]);
  });
});

describe('fingerprintManifests', () => {
  const setup = () => {
    put(worktree, 'package.json', JSON.stringify({ dependencies: { zod: '^3' } }));
    put(worktree, 'apps/web/package.json', '{}');
    return collectManifests(worktree);
  };

  it('is stable when nothing changed', () => {
    const m = setup();
    expect(fingerprintManifests(worktree, m)).toBe(fingerprintManifests(worktree, m));
  });

  it('changes when a dependency is added — the trigger for a re-install', () => {
    const m = setup();
    const before = fingerprintManifests(worktree, m);
    put(worktree, 'package.json', JSON.stringify({ dependencies: { zod: '^3', pino: '^9' } }));
    expect(fingerprintManifests(worktree, m)).not.toBe(before);
  });

  it('changes when a new workspace package appears', () => {
    const before = fingerprintManifests(worktree, setup());
    put(worktree, 'packages/core/package.json', '{}');
    expect(fingerprintManifests(worktree, collectManifests(worktree))).not.toBe(before);
  });

  it('is empty when there is no manifest, so no install is attempted', () => {
    expect(fingerprintManifests(worktree, [])).toBe('');
  });
});

describe('sidecar layout', () => {
  it('keeps the shared tree out of the git checkout', () => {
    // The manifests must sit next to node_modules for an install to work, so
    // they go in the sidecar — putting them in the root working tree would
    // leave it dirty and block `git checkout` once the PR adds the same files.
    expect(SIDECAR_DIR.startsWith('.')).toBe(true);
    expect(path.join(root, SIDECAR_DIR)).not.toBe(root);
  });
});

describe('bootstrapProjectDependencies', () => {
  /** Give the sidecar a populated tree whose fingerprint already matches. */
  const primeSidecar = (packageDirs: string[]) => {
    const sidecar = path.join(root, SIDECAR_DIR);
    for (const rel of packageDirs) {
      fs.mkdirSync(path.join(sidecar, rel, 'node_modules', '.bin'), { recursive: true });
    }
    const manifests = collectManifests(worktree);
    fs.writeFileSync(
      path.join(sidecar, '.rapitas-fingerprint'),
      fingerprintManifests(worktree, manifests),
      'utf8',
    );
    return sidecar;
  };

  const linkTargetOf = (rel: string) => {
    const p = path.join(worktree, rel, 'node_modules');
    return fs.lstatSync(p).isSymbolicLink() ? fs.readlinkSync(p) : null;
  };

  it('links the shared tree in and runs no install when the fingerprint matches', async () => {
    put(worktree, 'package.json', '{}');
    put(worktree, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    put(worktree, 'apps/web/package.json', '{}');
    const sidecar = primeSidecar(['', 'apps/web']);

    const result = await bootstrapProjectDependencies(worktree);

    expect(result.action).toBe('linked');
    expect(linkTargetOf('')).toBe(path.join(sidecar, 'node_modules'));
    expect(linkTargetOf('apps/web')).toBe(path.join(sidecar, 'apps', 'web', 'node_modules'));
    // The binaries the agent's lint/test/build commands resolve through.
    expect(fs.existsSync(path.join(worktree, 'node_modules', '.bin'))).toBe(true);
  });

  it('is idempotent: a second launch re-uses the same links', async () => {
    put(worktree, 'package.json', '{}');
    const sidecar = primeSidecar(['']);
    await bootstrapProjectDependencies(worktree);
    const result = await bootstrapProjectDependencies(worktree);
    expect(result.action).toBe('linked');
    expect(linkTargetOf('')).toBe(path.join(sidecar, 'node_modules'));
  });

  it('replaces a link that points at a stale tree', async () => {
    put(worktree, 'package.json', '{}');
    const sidecar = primeSidecar(['']);
    const stale = path.join(base, 'old-tree');
    fs.mkdirSync(stale, { recursive: true });
    fs.symlinkSync(stale, path.join(worktree, 'node_modules'), 'junction');

    await bootstrapProjectDependencies(worktree);
    expect(linkTargetOf('')).toBe(path.join(sidecar, 'node_modules'));
  });

  it('never overwrites a real node_modules already in the worktree', async () => {
    put(worktree, 'package.json', '{}');
    primeSidecar(['']);
    fs.mkdirSync(path.join(worktree, 'node_modules', 'zod'), { recursive: true });

    await bootstrapProjectDependencies(worktree);
    // Still a real directory with its contents — replacing it would destroy an install.
    expect(fs.lstatSync(path.join(worktree, 'node_modules')).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(worktree, 'node_modules', 'zod'))).toBe(true);
  });

  it('does nothing for a docs-only repo instead of attempting an install', async () => {
    // ContextFlow's state when task 1152 blocked.
    put(worktree, 'docs/design.md', '# design');
    const result = await bootstrapProjectDependencies(worktree);
    expect(result.action).toBe('skipped');
    expect(fs.existsSync(path.join(root, SIDECAR_DIR))).toBe(false);
  });

  it('excludes the sidecar from the project root git status', async () => {
    put(worktree, 'package.json', '{}');
    fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
    primeSidecar(['']);
    await bootstrapProjectDependencies(worktree);
    const exclude = path.join(root, '.git', 'info', 'exclude');
    expect(fs.readFileSync(exclude, 'utf8')).toContain(`/${SIDECAR_DIR}/`);
  });
});
