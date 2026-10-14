/**
 * GitOperations — Prisma state of a non-rapitas project
 *
 * Reads what a generated project declares and what it already has: which Prisma
 * schemas exist, a fingerprint that changes exactly when a regenerate is
 * warranted, and whether a usable client is already present.
 *
 * NOT responsible for running `prisma generate` — project-prisma-client owns
 * that decision and its invocation.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SCAN_DEPTH } from './project-manifests';

/** Directories never worth walking for a schema. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.worktrees']);

/** Files a real `prisma generate` always writes; an empty dir is a dead partial run. */
const CLIENT_ENTRYPOINTS = ['index.js', 'default.js'];

/**
 * Relative paths of every Prisma schema below `root`.
 *
 * Finds both layouts: a `prisma/schema.prisma` file and the `prismaSchemaFolder`
 * form (`prisma/schema/*.prisma`), which is reported as its containing directory
 * because that is what `--schema` takes.
 *
 * @param root - Project root to scan / 走査するプロジェクトルート
 * @returns Relative schema paths, sorted / 相対パス（ソート済み）
 */
export function findPrismaSchemas(root: string): string[] {
  const found: string[] = [];
  const walk = (rel: string, depth: number): void => {
    if (depth > SCAN_DEPTH + 1) return;
    let entries: { name: string; dir: boolean }[];
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true }).map((e) => ({
        name: e.name,
        dir: e.isDirectory(),
      }));
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (!e.dir) {
        if (e.name === 'schema.prisma') found.push(childRel);
        continue;
      }
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      // A schema FOLDER: the directory itself is what --schema receives, and its
      // .prisma files must not also be reported individually.
      if (
        e.name === 'schema' &&
        rel.endsWith('prisma') &&
        readdirSync(join(root, childRel)).some((f) => f.endsWith('.prisma'))
      ) {
        found.push(childRel);
        continue;
      }
      walk(childRel, depth + 1);
    }
  };
  walk('', 1);
  return found.sort();
}

/**
 * Fingerprint of the schema set: changes exactly when a regenerate is warranted.
 *
 * @param root - Project root / プロジェクトルート
 * @param schemas - Relative paths from {@link findPrismaSchemas} / 相対パス
 * @returns Hex digest, or '' when there is no schema / ダイジェスト
 */
export function fingerprintSchemas(root: string, schemas: string[]): string {
  if (schemas.length === 0) return '';
  const hash = createHash('sha256');
  for (const rel of schemas) {
    hash.update(rel);
    hash.update('\0');
    const abs = join(root, rel);
    try {
      // A schema folder hashes every .prisma inside it, in a stable order.
      const files = readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.prisma'))
        .map((e) => e.name)
        .sort();
      for (const f of files) {
        hash.update(f);
        hash.update(readFileSync(join(abs, f)));
      }
    } catch {
      try {
        hash.update(readFileSync(abs));
      } catch {
        hash.update('<unreadable>');
      }
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * The nearest package.json directory at or above `dir`, bounded by `root`.
 *
 * @param root - Project root, the upper bound / プロジェクトルート
 * @param dir - Directory to walk up from / 起点ディレクトリ
 * @returns Owning package directory, or `root` / 所有パッケージのディレクトリ
 */
export function nearestPackageDir(root: string, dir: string): string {
  let here = dir;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(here, 'package.json'))) return here;
    if (here === root) break;
    const parent = dirname(here);
    if (parent === here) break;
    here = parent;
  }
  return root;
}

/** True when `dir` is a generated client and not an empty leftover. */
function isGeneratedClient(dir: string): boolean {
  return CLIENT_ENTRYPOINTS.some((f) => existsSync(join(dir, f)));
}

/**
 * Whether a generated client exists anywhere this project would resolve it.
 *
 * NOTE: pnpm does NOT hoist it. Measured on temporaid 2026-10-11, the client is
 * at `node_modules/.pnpm/@prisma+client@5.20.0_prisma@5.20.0/node_modules/
 * .prisma/client` and root `node_modules/.prisma` does not exist at all.
 * Checking only the hoisted path made the regenerate-skip unreachable, so every
 * agent launch regenerated — found by running this against the real project
 * rather than by reasoning about it.
 *
 * @param root - Project root / プロジェクトルート
 * @param schemas - Relative schema paths, to also check their own packages / スキーマの相対パス
 * @returns Whether a usable client is present / 利用可能なクライアントがあるか
 */
export function prismaClientPresent(root: string, schemas: string[]): boolean {
  const dirs = new Set([root]);
  for (const rel of schemas) dirs.add(nearestPackageDir(root, dirname(join(root, rel))));
  // npm / yarn / bun, and pnpm's own `node-linker=hoisted`.
  for (const dir of dirs) {
    if (isGeneratedClient(join(dir, 'node_modules', '.prisma', 'client'))) return true;
  }
  // pnpm's virtual store: one directory per @prisma/client version+peer hash.
  try {
    for (const entry of readdirSync(join(root, 'node_modules', '.pnpm'), { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('@prisma+client@')) continue;
      const dir = join(
        root,
        'node_modules',
        '.pnpm',
        entry.name,
        'node_modules',
        '.prisma',
        'client',
      );
      if (isGeneratedClient(dir)) return true;
    }
  } catch {
    /* no pnpm store here */
  }
  return false;
}
