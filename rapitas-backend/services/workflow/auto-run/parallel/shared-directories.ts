/**
 * shared-directories
 *
 * The "same folder" pair rule: which parent folders two plans share, and
 * whether a folder is too broad for sharing it to mean anything. Split out of
 * parallel-safety-rules.ts. Not responsible for the other pair rules.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PlanFileSet } from './parallel-safety-rules';

/**
 * A folder with at least this many entries is "broad": two tasks touching it
 * say nothing about a collision. NOTE: rapitas-backend/services/workflow has
 * 666 entries, and as "same_directory" it refused 3 of 8 candidates (2026-11-27).
 */
export const BROAD_DIRECTORY_MIN_ENTRIES = 30;

const PACKAGE_ROOTS = ['', 'rapitas-backend/', 'rapitas-frontend/', 'rapitas-desktop/'];

function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i > 0 ? file.slice(0, i) : '';
}

/**
 * Folders both sides touch (parent folder only, suffix-matched like files).
 *
 * @param a - One side / 片方
 * @param b - Other side / もう片方
 * @returns Shared folders / 共通フォルダ
 */
export function sharedDirectories(a: PlanFileSet, b: PlanFileSet): string[] {
  const out = new Set<string>();
  for (const fa of a.files) {
    const da = dirOf(fa);
    if (!da) continue;
    for (const fb of b.files) {
      const db = dirOf(fb);
      if (db && (da === db || da.endsWith(`/${db}`) || db.endsWith(`/${da}`))) out.add(da);
    }
  }
  return [...out];
}

/**
 * Build a cached check for whether a plan folder is broad in this checkout.
 * A folder that cannot be read is not broad, so the rule stays fail-closed.
 *
 * @param cwd - Repository root / リポジトリのルート
 * @returns Folder → broad? / フォルダが広すぎるか
 */
export function createBroadDirectoryCheck(cwd: string): (dir: string) => boolean {
  const cache = new Map<string, boolean>();
  return (dir) => {
    const hit = cache.get(dir);
    if (hit !== undefined) return hit;
    let broad = false;
    for (const prefix of PACKAGE_ROOTS) {
      try {
        broad = readdirSync(join(cwd, prefix + dir)).length >= BROAD_DIRECTORY_MIN_ENTRIES;
        break;
      } catch {
        // Not under this package root; try the next one.
      }
    }
    cache.set(dir, broad);
    return broad;
  };
}
