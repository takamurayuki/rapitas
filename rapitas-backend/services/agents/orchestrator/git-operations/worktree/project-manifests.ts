/**
 * project-manifests
 *
 * Reads a JavaScript project's manifest set: which files decide what an install
 * produces, how to invoke the right package manager, and a fingerprint that
 * changes exactly when a reinstall is warranted.
 *
 * NOT responsible for running the install or for linking node_modules —
 * project-dependency-bootstrap owns that.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How deep below a project root to look for workspace manifests. */
export const SCAN_DEPTH = 3;

/** Root-level files that change what an install produces. */
const ROOT_MANIFESTS = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  '.npmrc',
  '.nvmrc',
];

/** Lockfile → install command, most specific first. */
const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm install'],
  ['bun.lockb', 'bun install'],
  ['bun.lock', 'bun install'],
  ['yarn.lock', 'yarn install'],
  ['package-lock.json', 'npm install'],
];

/**
 * Pick the install command for a manifest directory.
 *
 * Falls back to the `packageManager` field and then to pnpm when a
 * `pnpm-workspace.yaml` is present, because a freshly scaffolded project has no
 * lockfile yet — which is exactly when this runs first.
 *
 * @param dir - Directory holding package.json / package.json のあるディレクトリ
 * @returns Shell command to install / 実行するインストールコマンド
 */
export function resolveInstallCommand(dir: string): string {
  for (const [lockfile, command] of LOCKFILES) {
    if (existsSync(join(dir, lockfile))) return command;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      packageManager?: unknown;
    };
    if (typeof pkg.packageManager === 'string') {
      const name = pkg.packageManager.split('@')[0];
      if (['pnpm', 'yarn', 'npm', 'bun'].includes(name)) return `${name} install`;
    }
  } catch {
    /* unreadable manifest — fall through to the workspace/npm default */
  }
  return existsSync(join(dir, 'pnpm-workspace.yaml')) ? 'pnpm install' : 'npm install';
}

/**
 * Add invocation flags the chosen package manager needs to exit 0 on a
 * successful install.
 *
 * pnpm 11+ defaults `strictDepBuilds` to true, so skipping a dependency's build
 * script is an ERROR (`ERR_PNPM_IGNORED_BUILDS`) even though node_modules and
 * the lockfile were written correctly. Measured on 2026-10-08: TempoRaid's
 * install completed and then exited non-zero over ten ignored builds (prisma,
 * argon2, esbuild, …), so the fingerprint was never written and the install was
 * retried on every single agent launch.
 *
 * The flag downgrades that to a warning; it does NOT approve the scripts. Which
 * dependencies may run build scripts is the project's own decision, via
 * `onlyBuiltDependencies` in its manifest.
 *
 * @param command - Base command from {@link resolveInstallCommand} / 基本コマンド
 * @returns Command to execute / 実行するコマンド
 */
export function installInvocation(command: string): string {
  return command.startsWith('pnpm') ? `${command} --config.strict-dep-builds=false` : command;
}

/**
 * Directory names skipped when walking a project for manifests.
 * `.`-prefixed directories are skipped too; none of them hold a workspace.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);

/**
 * Relative paths of every manifest file in `source`, sorted.
 *
 * @param source - Checkout to scan / 走査するチェックアウト
 * @returns Relative manifest paths / 相対パス（ソート済み）
 */
export function collectManifests(source: string): string[] {
  const found = ROOT_MANIFESTS.filter((f) => existsSync(join(source, f)));
  const walk = (rel: string, depth: number): void => {
    if (depth > SCAN_DEPTH) return;
    let dirs: string[];
    try {
      dirs = readdirSync(join(source, rel), { withFileTypes: true })
        .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const name of dirs) {
      const childRel = rel ? `${rel}/${name}` : name;
      if (existsSync(join(source, childRel, 'package.json'))) {
        found.push(`${childRel}/package.json`);
      }
      walk(childRel, depth + 1);
    }
  };
  walk('', 1);
  return found.sort();
}

/**
 * Fingerprint of the manifest set: changes exactly when an install would
 * produce something different.
 *
 * @param source - Checkout to fingerprint / 対象チェックアウト
 * @param manifests - Relative paths from {@link collectManifests} / 相対パス
 * @returns Hex digest, or '' when there is no manifest at all / ダイジェスト
 */
export function fingerprintManifests(source: string, manifests: string[]): string {
  if (manifests.length === 0) return '';
  const hash = createHash('sha256');
  for (const rel of manifests) {
    hash.update(rel);
    hash.update('\0');
    try {
      hash.update(readFileSync(join(source, rel)));
    } catch {
      hash.update('<unreadable>');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}
