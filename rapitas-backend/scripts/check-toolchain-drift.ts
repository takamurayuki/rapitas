/**
 * check-toolchain-drift
 *
 * Fails when a workflow installs a toolchain version that disagrees with
 * `.github/toolchain.json`, or pins one loosely ('latest', a bare major).
 *
 * Not responsible for choosing the versions — that is toolchain.json's job.
 *
 * WHY: three Bun versions were writing and validating one bun.lock (1.3.13 in
 * the gates, 1.3.11 in update-lockfiles, 'latest' in seven jobs including the
 * lockfile bot), and bun 1.3.13 writes lockfileVersion 1 while a newer bun
 * writes 2. The bot therefore proposed a 1->2 bump plus package upgrades
 * against every feature branch. pnpm was a floating 'pnpm@10' against a
 * lockfileVersion 9.0 tree. An audit, a test run and a release build cannot
 * use the same dependencies while the resolver version differs between them.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/** Pinned versions every workflow must install. */
interface Toolchain {
  bun: string;
  pnpm: string;
  node: string;
}

export interface ToolchainViolation {
  file: string;
  line: number;
  found: string;
  expected: string;
  tool: 'bun' | 'pnpm' | 'node';
}

/**
 * Find every toolchain pin in a workflow that disagrees with `toolchain`.
 *
 * Expression values (`${{ … }}`) are skipped: a matrix build chooses its own
 * versions on purpose, and this check is about accidental drift.
 *
 * @param content - The workflow YAML / ワークフローの内容
 * @param file - Name used in the report / 報告に使うファイル名
 * @param toolchain - The pinned versions / 固定されたバージョン
 * @returns One entry per disagreement / 不一致ごとに1件
 */
export function findToolchainViolations(
  content: string,
  file: string,
  toolchain: Toolchain,
): ToolchainViolation[] {
  const violations: ToolchainViolation[] = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (line.startsWith('#')) return;

    const checks: Array<{ re: RegExp; tool: ToolchainViolation['tool']; expected: string }> = [
      { re: /^bun-version:\s*(.+)$/, tool: 'bun', expected: toolchain.bun },
      // Matrix-declared versions. `bun-version: ${{ matrix.x }}` is skipped as
      // an expression, so without this the value the matrix actually supplies
      // escapes the check — which is how the release build (tauri-build.yml)
      // ended up on bun 1.3.11 while the gates were on 1.3.13.
      { re: /^-?\s*bunjs_version:\s*(.+)$/, tool: 'bun', expected: toolchain.bun },
      { re: /^-?\s*bun_version:\s*(.+)$/, tool: 'bun', expected: toolchain.bun },
      { re: /^node-version:\s*(.+)$/, tool: 'node', expected: toolchain.node },
      // `npm install -g pnpm@X` is how every job installs pnpm here.
      { re: /npm install -g pnpm@(\S+)/, tool: 'pnpm', expected: toolchain.pnpm },
    ];

    for (const { re, tool, expected } of checks) {
      const m = line.match(re);
      if (!m) continue;
      const found = m[1]!.trim().replace(/^['"]|['"]$/g, '');
      // A matrix or other expression is a deliberate choice, not drift.
      if (found.includes('${{')) continue;
      if (found !== expected) {
        violations.push({ file, line: index + 1, found, expected, tool });
      }
    }
  });

  return violations;
}

/**
 * Read toolchain.json and check every workflow against it.
 *
 * @param repoRoot - Repository root / リポジトリのルート
 * @returns Every disagreement found / 見つかった不一致すべて
 */
export function checkWorkflows(repoRoot: string): ToolchainViolation[] {
  const toolchain = JSON.parse(
    readFileSync(join(repoRoot, '.github', 'toolchain.json'), 'utf8'),
  ) as Toolchain;

  const dir = join(repoRoot, '.github', 'workflows');
  const files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));

  const violations = files.flatMap((f) =>
    findToolchainViolations(readFileSync(join(dir, f), 'utf8'), f, toolchain),
  );

  // NOTE(#1340 step 1): the distribution build is checked too. It downloaded a
  // hardcoded Bun 1.1.42 — two minor versions behind every gate — so the
  // binary that SHIPS was compiled by a Bun nothing tests against. Pinning the
  // workflows while leaving the release path on its own version is the gap
  // this check exists to close, so the file is required to read the version
  // from toolchain.json rather than to state one.
  const distBuild = join(repoRoot, 'rapitas-desktop', 'scripts', 'build-backend-windows.js');
  const dist = readFileSync(distBuild, 'utf8');
  const literal = dist.match(/const BUN_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (literal) {
    violations.push({
      file: 'rapitas-desktop/scripts/build-backend-windows.js',
      line: dist.slice(0, literal.index).split(/\r?\n/).length,
      found: literal[1]!,
      expected: `read from .github/toolchain.json (${toolchain.bun})`,
      tool: 'bun',
    });
  }

  return violations;
}

// Entry point: `bun run scripts/check-toolchain-drift.ts`
if (import.meta.main) {
  const repoRoot = join(import.meta.dir, '..', '..');
  const violations = checkWorkflows(repoRoot);

  if (violations.length === 0) {
    console.log('[toolchain] every workflow matches .github/toolchain.json');
    process.exit(0);
  }

  console.error(
    `[toolchain] ${violations.length} version(s) disagree with .github/toolchain.json:`,
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.tool}: found ${v.found}, expected ${v.expected}`);
  }
  console.error('');
  console.error('A floating version means the audit, the tests and the release build can');
  console.error('resolve different dependency trees. Update the workflow, or change');
  console.error('.github/toolchain.json and every workflow together.');
  process.exit(1);
}
