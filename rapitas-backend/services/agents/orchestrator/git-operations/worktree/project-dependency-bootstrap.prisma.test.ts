/**
 * project-dependency-bootstrap.prisma.test
 *
 * 生成プロジェクトの Prisma クライアント生成がブートストラップに配線されていること。
 *
 * 分割理由: 親の project-dependency-bootstrap.test.ts はインストール分岐の判定に
 * 専念しており、300 行上限にも近い。ここは「クライアントをルートで生成する」という
 * 別の責務だけを固定する。
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootstrapProjectDependencies } from './project-dependency-bootstrap';
import { collectManifests, fingerprintManifests } from './project-manifests';

let base: string;
let root: string;
let worktree: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'boot-prisma-'));
  root = path.join(base, 'myapp');
  worktree = path.join(root, '.worktrees', 'task-1153-c3a5cb1f');
  fs.mkdirSync(worktree, { recursive: true });
});

afterEach(() => {
  // Clear the junction first: a recursive remove would descend through it.
  try {
    const link = path.join(worktree, 'node_modules');
    if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
  } catch {
    /* not present */
  }
  fs.rmSync(base, { recursive: true, force: true });
});

const put = (dir: string, rel: string, body: string) => {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
};

/** A root that is already installed and fingerprinted, so no install runs. */
const readyRoot = () => {
  put(root, 'package.json', '{}');
  for (const e of ['.bin', 'zod'])
    fs.mkdirSync(path.join(root, 'node_modules', e), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'node_modules', '.rapitas-deps-fingerprint'),
    fingerprintManifests(root, collectManifests(root)),
    'utf8',
  );
};

describe('bootstrapProjectDependencies — prisma client (2026-10-11)', () => {
  // An agent in a generated project's worktree CANNOT generate the client: the
  // worktree node_modules is a symlink to the root tree, so
  // primary-guard-hook.cjs denies `prisma generate` as a shared-tree write
  // (measured against the real hook). Nobody generated it, so temporaid had a
  // schema and no client at the hoisted path, and 5 of the 15 verify bounces in
  // the 24 h to 2026-10-11 were tests failing with that environment error. The
  // root is where the tree is real, so the bootstrap must do it there.
  it('generates the client at the project root, not in the worktree', async () => {
    readyRoot();
    put(root, 'apps/server/prisma/schema.prisma', 'model A { id Int @id }');

    const roots: string[] = [];
    const result = await bootstrapProjectDependencies(worktree, {
      ensurePrisma: async (r: string) => {
        roots.push(r);
        return { action: 'generated' as const, detail: 'apps/server/prisma/schema.prisma' };
      },
    });

    expect(roots).toEqual([root]);
    expect(result.detail).toContain('prisma generated');
  });

  it('does not mention prisma for a project without a schema', async () => {
    readyRoot();

    const result = await bootstrapProjectDependencies(worktree, {
      ensurePrisma: async () => ({ action: 'skipped' as const, detail: 'no prisma schema' }),
    });

    expect(result.detail).not.toContain('prisma');
  });

  // The client is a verification aid, not a precondition for doing the work:
  // blocking the launch would lose the whole task instead of one gate.
  it('still links and succeeds when generate fails', async () => {
    readyRoot();
    put(root, 'prisma/schema.prisma', 'model A { id Int @id }');

    const result = await bootstrapProjectDependencies(worktree, {
      ensurePrisma: async () => ({
        action: 'failed' as const,
        detail: 'pnpm run db:generate failed',
      }),
    });

    expect(result.action).toBe('linked');
    expect(result.detail).toContain('prisma failed');
    expect(fs.readlinkSync(path.join(worktree, 'node_modules'))).toBe(
      path.join(root, 'node_modules'),
    );
  });
});
