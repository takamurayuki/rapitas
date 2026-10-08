/**
 * project-dependency-bootstrap.test
 *
 * Covers which branch the bootstrap takes and what it records, without running
 * a package manager: the install paths are reached only in states that are
 * already prepared, so every assertion here is about the decision, not the
 * download. Real directories and junctions throughout — link handling is
 * exactly what a mocked fs would hide.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapProjectDependencies, projectRootOf } from './project-dependency-bootstrap';

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
  // Clear junctions first: a recursive remove would descend through them.
  for (const rel of ['', 'apps/web']) {
    const link = path.join(worktree, rel, 'node_modules');
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {
      /* not present */
    }
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const put = (dir: string, rel: string, body: string) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
};

/** Install `dir` and record the fingerprint so no reinstall is triggered. */
const installed = (dir: string, entries = ['.bin', 'zod']) => {
  for (const e of entries) fs.mkdirSync(path.join(dir, 'node_modules', e), { recursive: true });
};

const recordFingerprint = async (dir: string) => {
  const { collectManifests, fingerprintManifests } = await import('./project-manifests');
  fs.writeFileSync(
    path.join(dir, 'node_modules', '.rapitas-deps-fingerprint'),
    fingerprintManifests(dir, collectManifests(dir)),
    'utf8',
  );
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

describe('bootstrapProjectDependencies — the normal path', () => {
  it('links the root tree in and runs no install when the fingerprint matches', async () => {
    put(root, 'package.json', '{}');
    put(root, 'pnpm-workspace.yaml', "packages:\n  - 'apps/*'\n");
    put(root, 'apps/web/package.json', '{}');
    installed(root);
    installed(path.join(root, 'apps/web'));
    await recordFingerprint(root);

    const result = await bootstrapProjectDependencies(worktree);

    expect(result.action).toBe('linked');
    expect(fs.readlinkSync(path.join(worktree, 'node_modules'))).toBe(
      path.join(root, 'node_modules'),
    );
    expect(fs.readlinkSync(path.join(worktree, 'apps', 'web', 'node_modules'))).toBe(
      path.join(root, 'apps', 'web', 'node_modules'),
    );
    expect(fs.existsSync(path.join(worktree, 'node_modules', '.bin'))).toBe(true);
  });

  it('is idempotent across launches', async () => {
    put(root, 'package.json', '{}');
    installed(root);
    await recordFingerprint(root);

    await bootstrapProjectDependencies(worktree);
    const again = await bootstrapProjectDependencies(worktree);

    expect(again.action).toBe('linked');
    expect(again.detail).toContain('.');
  });

  it('replaces the worktree cache-only node_modules rather than skipping it', async () => {
    put(root, 'package.json', '{}');
    installed(root);
    await recordFingerprint(root);
    fs.mkdirSync(path.join(worktree, 'node_modules', '.vite'), { recursive: true });

    await bootstrapProjectDependencies(worktree);

    const link = path.join(worktree, 'node_modules');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(link, '.bin'))).toBe(true);
  });

  it('never destroys a real install already in the worktree', async () => {
    put(root, 'package.json', '{}');
    installed(root);
    await recordFingerprint(root);
    fs.mkdirSync(path.join(worktree, 'node_modules', 'left-alone'), { recursive: true });

    await bootstrapProjectDependencies(worktree);

    const link = path.join(worktree, 'node_modules');
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(link, 'left-alone'))).toBe(true);
  });

  it('links nothing when the root IS the target (not a worktree)', async () => {
    put(root, 'package.json', '{}');
    installed(root);
    await recordFingerprint(root);

    const result = await bootstrapProjectDependencies(root);

    expect(result.action).toBe('linked');
    expect(result.detail).toContain('none');
  });
});

describe('bootstrapProjectDependencies — the legacy path', () => {
  it('leaves a worktree alone when it already resolves dependencies', async () => {
    // A project scaffolded before the skeleton change: no root manifest, but an
    // earlier revision already linked or installed into this worktree.
    put(worktree, 'package.json', '{}');
    installed(worktree);

    const result = await bootstrapProjectDependencies(worktree);

    expect(result.action).toBe('skipped');
    expect(result.detail).toContain('already has usable node_modules');
  });

  it('treats a link to a live tree as already prepared', async () => {
    put(worktree, 'package.json', '{}');
    const elsewhere = path.join(base, 'old-shared-tree');
    installed(elsewhere);
    fs.symlinkSync(
      path.join(elsewhere, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'junction',
    );

    const result = await bootstrapProjectDependencies(worktree);

    expect(result.action).toBe('skipped');
    expect(fs.readlinkSync(path.join(worktree, 'node_modules'))).toBe(
      path.join(elsewhere, 'node_modules'),
    );
  });

  it('does nothing for a docs-only repo instead of attempting an install', async () => {
    // ContextFlow's state when task 1152 blocked.
    put(worktree, 'docs/design.md', '# design');
    const result = await bootstrapProjectDependencies(worktree);
    expect(result.action).toBe('skipped');
    expect(result.detail).toBe('no manifest');
  });

  it('never creates the retired .rapitas-deps sidecar', async () => {
    put(root, 'package.json', '{}');
    installed(root);
    await recordFingerprint(root);
    await bootstrapProjectDependencies(worktree);
    expect(fs.existsSync(path.join(root, '.rapitas-deps'))).toBe(false);
  });
});
