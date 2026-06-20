/**
 * related-tests
 *
 * Discovers the test files RELATED to an agent's changed source files and
 * builds the scoped test command for the verification gate. The previous gate
 * only ran tests the agent itself touched — so "changed foo.ts, broke
 * foo.test.ts" (the main regression case) ran nothing. Relatedness is by
 * basename convention: `dir/name.test.*`, `dir/__tests__/name.*`, and
 * `tests/**`/`name.*` (this repo's two layouts). Not responsible for running
 * commands or merging check results.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join, relative } from 'path';

/** Conventional test-file naming (foo.test.ts / foo.spec.tsx / .mts / .cjs …). */
export const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** How deep to scan a tests/ tree for basename matches. */
const TESTS_DIR_MAX_DEPTH = 5;

/**
 * True when a candidate test filename targets the given source basename:
 * `name.test.ts`, `name.spec.tsx`, `name.unit.test.ts` — anything starting
 * with `name.` that matches the test-file convention.
 */
function targetsBasename(candidate: string, sourceBase: string): boolean {
  return candidate.startsWith(`${sourceBase}.`) && TEST_FILE_RE.test(candidate);
}

/** Safe directory listing — empty on missing/unreadable dirs. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Recursively collects test files in a tests/ tree matching any basename. */
function scanTestsTree(dir: string, bases: Set<string>, depth: number, out: string[]): void {
  if (depth > TESTS_DIR_MAX_DEPTH) return;
  for (const entry of listDir(dir)) {
    const p = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(p).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      // Integration suites bind live ports/DBs and are excluded from the default
      // run (bunfig pathIgnorePatterns); never pull them into the gate.
      if (entry === 'integration') continue;
      scanTestsTree(p, bases, depth + 1, out);
    } else {
      for (const base of bases) {
        if (targetsBasename(entry, base)) {
          out.push(p);
          break;
        }
      }
    }
  }
}

/**
 * Finds test files related to the changed SOURCE files by basename convention.
 *
 * @param projectRoot - Nearest package.json dir / プロジェクトルート
 * @param projectRelFiles - Changed code files relative to projectRoot / 変更ファイル
 * @returns Related test files relative to projectRoot (deduped) / 関連テスト
 */
export function findRelatedTestFiles(projectRoot: string, projectRelFiles: string[]): string[] {
  const sources = projectRelFiles.filter((f) => !TEST_FILE_RE.test(f));
  if (sources.length === 0) return [];

  const found = new Set<string>();
  const allBases = new Set<string>();

  for (const src of sources) {
    const base = basename(src, extname(src));
    allBases.add(base);
    const srcDirAbs = join(projectRoot, src, '..');

    // Same directory: name.test.ts / name.spec.tsx / name.unit.test.ts …
    for (const entry of listDir(srcDirAbs)) {
      if (targetsBasename(entry, base)) found.add(join(srcDirAbs, entry));
    }
    // Co-located __tests__/ directory.
    for (const entry of listDir(join(srcDirAbs, '__tests__'))) {
      if (targetsBasename(entry, base)) found.add(join(srcDirAbs, '__tests__', entry));
    }
  }

  // Project-level tests/ tree (this backend's layout: tests/services/foo.test.ts).
  const testsRoot = join(projectRoot, 'tests');
  if (existsSync(testsRoot)) {
    const treeHits: string[] = [];
    scanTestsTree(testsRoot, allBases, 0, treeHits);
    for (const hit of treeHits) found.add(hit);
  }

  return [...found].map((abs) => relative(projectRoot, abs).replace(/\\/g, '/')).sort();
}

/** The package-manager `exec` prefix for invoking a local bin, by lockfile. */
function execPrefix(projectRoot: string): string {
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm exec';
  if (existsSync(join(projectRoot, 'yarn.lock'))) return 'yarn exec';
  return 'npx';
}

/**
 * Builds the test command(s) for the gate, SCOPED to the agent's changed test
 * files PLUS the tests related to its changed sources. Running the whole suite
 * gates on pre-existing red tests and live-port collisions (false positives),
 * while the old changed-tests-only scoping missed source regressions entirely.
 *
 * File-scopeable runners (bun, vitest): scoped run, ON by default
 * (RAPITAS_VERIFY_TESTS=0 disables). Returns null when nothing is in scope —
 * a change with no related test is NOT gated on the rest of the suite.
 * - bun: ONE command for ALL test files using `--isolate`. Each file runs in its
 *   own module registry so mock.module state cannot leak across files, eliminating
 *   the false failures caused by process-global mock contamination.
 * - vitest: ONE command for all files (vitest isolates per-file already), via
 *   `<pm> exec vitest run <files>`. Frontend (vitest/pnpm, no bun.lock) used to
 *   fall through to the full-suite branch below and gate on unrelated red tests.
 *
 * Other non-bun/non-vitest runners can't be file-scoped reliably here, so they
 * stay full-suite and opt-in (RAPITAS_VERIFY_TESTS=1).
 *
 * @param projectRoot - Nearest package.json dir (test runner cwd) / プロジェクトルート
 * @param workdir - The agent's worktree root / worktree ルート
 * @param relFiles - Changed code files relative to workdir / 変更コードファイル
 * @returns Shell commands (run each separately), or null when nothing should run / 実行コマンド群
 */
export function buildScopedTestCommands(
  projectRoot: string,
  workdir: string,
  relFiles: string[],
): string[] | null {
  const raw = process.env.RAPITAS_VERIFY_TESTS;
  if (raw === '0' || raw === 'false') return null;

  const pkgPath = join(projectRoot, 'package.json');
  if (!existsSync(pkgPath)) return null;
  let testScript = '';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> };
    testScript = pkg.scripts?.test ?? '';
    if (!testScript) return null;
  } catch {
    return null;
  }

  // The set of test files in scope: the agent's own changed tests + tests
  // related (by basename) to its changed sources. Shared by all file-scopeable
  // runners; empty → the change has no covering test, so skip (don't full-suite).
  const projectRel = relFiles.map((f) =>
    relative(projectRoot, join(workdir, f)).replace(/\\/g, '/'),
  );
  const changedTests = projectRel.filter((f) => TEST_FILE_RE.test(f));
  const related = findRelatedTestFiles(projectRoot, projectRel);
  const scoped = [...new Set([...changedTests, ...related])];

  const usesBun =
    existsSync(join(projectRoot, 'bun.lockb')) || existsSync(join(projectRoot, 'bun.lock'));
  if (usesBun) {
    if (scoped.length === 0) return null;
    // NOTE: --isolate gives each file its own module registry so mock.module
    // state cannot leak across files — eliminates false failures from contamination.
    const files = scoped.map((f) => `"${f}"`).join(' ');
    return [`bun test --isolate ${files}`];
  }

  // vitest is file-scopeable too; treat it like bun (default-on, never full-suite).
  if (/\bvitest\b/.test(testScript)) {
    if (scoped.length === 0) return null;
    const files = scoped.map((f) => `"${f}"`).join(' ');
    return [`${execPrefix(projectRoot)} vitest run ${files}`];
  }

  // Other non-bun runners can't be file-scoped reliably → full suite, opt-in only.
  if (raw !== '1' && raw !== 'true') return null;
  if (existsSync(join(projectRoot, 'pnpm-lock.yaml'))) return ['pnpm run test'];
  if (existsSync(join(projectRoot, 'yarn.lock'))) return ['yarn run test'];
  return ['npm run test'];
}
