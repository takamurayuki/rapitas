#!/usr/bin/env node
/**
 * check-import-graph
 *
 * Fails CI when an import breaks a layer's direction (e.g. backend
 * services/ importing routes/) or closes a new import cycle, as a ratchet:
 * today's violations are listed in import-graph-baseline.json, anything not
 * listed fails, and a listed entry that no longer occurs also fails until it
 * is removed, so the baseline can only shrink and never goes stale.
 * Not responsible for fixing the baselined violations — see #1410.
 *
 * What counts:
 *   - direction: every import form (static, type-only, dynamic, require),
 *     production files only — tests may import anything.
 *   - cycles: runtime edges only (static imports, re-exports, require).
 *     Type-only imports are erased by the compiler and dynamic import() is
 *     the usual way to break an init-order cycle, so neither can close one.
 *     Tests are in the graph, but nothing imports a test, so they can only
 *     close a cycle among test helpers — which is still a cycle.
 *
 * Usage: node scripts/import-graph/check-import-graph.cjs [--update-baseline]
 *   --update-baseline rewrites the baseline to the current state. It is for
 *   SHRINKING after a fix; it warns loudly when it would add entries.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractImports,
  parseTsconfigAliases,
  resolveSpecifier,
  CODE_EXTS,
} = require('./scan-imports.cjs');
const { normalizeCycle, findCycles } = require('./find-cycles.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'import-graph-baseline.json');

/** Path segments that are never part of the graph. */
const SKIP_DIR = /(^|\/)(node_modules|generated|\.next|\.next-tauri|dist|out|coverage)\//;
// Two separate tests on purpose: a test DIRECTORY anywhere in the path, or a
// test-file SUFFIX. One alternation mixed an unanchored and an end-anchored
// branch (CodeQL js/regex/missing-regexp-anchor).
const TEST_DIR = /(?:^|\/)(?:__tests__|__mocks__|tests|test|e2e)\//;
const TEST_SUFFIX = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_FILE = { test: (p) => TEST_DIR.test(p) || TEST_SUFFIX.test(p) };

/**
 * Packages and their direction rules. `from`/`to` are package-relative path
 * prefixes; a production file under `from` must not import a file under `to`.
 */
const PACKAGES = [
  {
    name: 'rapitas-backend',
    rules: [
      {
        id: 'services-must-not-import-routes',
        from: ['services/', 'src/services/'],
        to: ['routes/', 'register-routes.ts'],
      },
      {
        id: 'utils-must-not-import-routes-or-services',
        from: ['utils/'],
        to: ['routes/', 'register-routes.ts', 'services/', 'src/services/'],
      },
      {
        id: 'config-must-not-import-routes-or-services',
        from: ['config/'],
        to: ['routes/', 'register-routes.ts', 'services/', 'src/services/'],
      },
    ],
  },
  {
    name: 'rapitas-frontend',
    rules: [
      {
        id: 'ui-must-not-import-features',
        from: ['src/components/ui/'],
        to: ['src/feature/', 'src/app/'],
      },
      {
        id: 'lib-utils-must-not-import-app',
        from: ['src/lib/', 'src/utils/'],
        to: ['src/app/'],
      },
    ],
  },
];

/**
 * Build the import graph of one package.
 *
 * @param {string[]} files - Package-relative posix paths (all files, not just code) / パッケージ内のファイル
 * @param {(file: string) => string} read - Reads a package-relative file / ファイル読み込み
 * @param {{prefix: string, targets: string[]}[]} aliases - tsconfig path aliases / エイリアス
 * @returns {{nodes: string[], edges: {from: string, to: string, kind: string}[]}} The graph / グラフ
 */
function buildGraph(files, read, aliases) {
  const all = new Set(files.filter((f) => !SKIP_DIR.test(f)));
  const nodes = [...all]
    .filter((f) => CODE_EXTS.includes(path.posix.extname(f)) && !f.endsWith('.d.ts'))
    .sort();
  const edges = [];
  for (const file of nodes) {
    const seen = new Set();
    for (const { spec, kind } of extractImports(read(file))) {
      const to = resolveSpecifier(file, spec, all, aliases);
      if (!to || to === file || to.endsWith('.d.ts')) continue;
      const key = `${to}\0${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: file, to, kind });
    }
  }
  return { nodes, edges };
}

const under = (file, prefixes) =>
  prefixes.some((p) => (p.endsWith('/') ? file.startsWith(p) : file === p));

/**
 * Direction-rule violations, one `rule: from -> to` string per file pair.
 *
 * @param {string} pkg - Package name, prefixed onto paths / パッケージ名
 * @param {{from: string, to: string}[]} edges - Graph edges / エッジ
 * @param {{id: string, from: string[], to: string[]}[]} rules - Direction rules / 方向ルール
 * @returns {string[]} Sorted, de-duplicated violations / 違反一覧
 */
function directionViolations(pkg, edges, rules) {
  const out = new Set();
  for (const e of edges) {
    if (TEST_FILE.test(e.from)) continue;
    for (const r of rules) {
      if (under(e.from, r.from) && under(e.to, r.to))
        out.add(`${r.id}: ${pkg}/${e.from} -> ${pkg}/${e.to}`);
    }
  }
  return [...out].sort();
}

/**
 * Compare the current findings with the baseline.
 *
 * @param {{direction: string[], cycles: string[]}} current - Found now / 現在の検出結果
 * @param {{direction: string[], cycles: string[]}} baseline - Recorded / ベースライン
 * @returns {{added: {direction: string[], cycles: string[]}, stale: {direction: string[], cycles: string[]}}} Diff / 差分
 */
function compareWithBaseline(current, baseline) {
  const renormalize = (c) => normalizeCycle(c.split(' -> ').slice(0, -1));
  const diff = { added: {}, stale: {} };
  for (const key of ['direction', 'cycles']) {
    const now = new Set(current[key]);
    // Cycles are re-normalised so a hand-written entry may start at any node.
    const recorded = (baseline[key] || []).map((x) => (key === 'cycles' ? renormalize(x) : x));
    const then = new Set(recorded);
    diff.added[key] = current[key].filter((x) => !then.has(x));
    diff.stale[key] = [...then].filter((x) => !now.has(x)).sort();
  }
  return diff;
}

/**
 * Analyse every package in PACKAGES from the git-tracked (and untracked,
 * not-ignored) files of the working tree.
 *
 * @returns {{direction: string[], cycles: string[], stats: object}} Findings / 検出結果
 */
function analyzeRepo() {
  const direction = [];
  const cycles = [];
  const stats = {};
  for (const pkg of PACKAGES) {
    const pkgRoot = path.join(ROOT, pkg.name);
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.'],
      {
        cwd: pkgRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => fs.existsSync(path.join(pkgRoot, f)));
    const tsconfig = path.join(pkgRoot, 'tsconfig.json');
    const aliases = fs.existsSync(tsconfig)
      ? parseTsconfigAliases(fs.readFileSync(tsconfig, 'utf8'), '')
      : [];
    const graph = buildGraph(files, (f) => fs.readFileSync(path.join(pkgRoot, f), 'utf8'), aliases);
    direction.push(...directionViolations(pkg.name, graph.edges, pkg.rules));
    cycles.push(...findCycles(pkg.name, graph.nodes, graph.edges));
    stats[pkg.name] = { files: graph.nodes.length, edges: graph.edges.length };
  }
  return { direction: direction.sort(), cycles: cycles.sort(), stats };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { direction: [], cycles: [] };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(current) {
  const body = { direction: current.direction, cycles: current.cycles };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(body, null, 2)}\n`);
}

function main() {
  const started = Date.now();
  const current = analyzeRepo();
  const baseline = readBaseline();
  const diff = compareWithBaseline(current, baseline);
  const counts = (o) => o.direction.length + o.cycles.length;
  const summary = Object.entries(current.stats)
    .map(([name, s]) => `${name}: ${s.files} files, ${s.edges} edges`)
    .join('; ');

  if (process.argv.includes('--update-baseline')) {
    if (counts(diff.added) > 0) {
      console.warn('!!! WARNING: --update-baseline is ADDING entries to the baseline. !!!');
      console.warn('!!! The baseline is meant to shrink. Fix these instead of recording them: !!!');
      for (const x of [...diff.added.direction, ...diff.added.cycles]) console.warn(`  + ${x}`);
    }
    writeBaseline(current);
    console.log(
      `import-graph: baseline written (${current.direction.length} direction, ${current.cycles.length} cycles; ` +
        `-${counts(diff.stale)} +${counts(diff.added)}).`,
    );
    return;
  }

  const lines = [];
  for (const x of diff.added.direction) lines.push(`  NEW direction violation  ${x}`);
  for (const x of diff.added.cycles) lines.push(`  NEW import cycle         ${x}`);
  for (const x of [...diff.stale.direction, ...diff.stale.cycles])
    lines.push(`  STALE baseline entry     ${x}`);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  if (lines.length) {
    console.error(`import-graph: ${lines.length} problem(s) (${summary}; ${elapsed}s)`);
    console.error(lines.join('\n'));
    if (counts(diff.added)) {
      console.error(
        '\nNEW entries: remove the import (move shared code down a layer, or use a type-only import / ' +
          'dynamic import() if it only needs to break a cycle). Do not add it to the baseline.',
      );
    }
    if (counts(diff.stale)) {
      console.error(
        '\nSTALE entries were fixed — well done. Shrink the baseline: ' +
          'node scripts/import-graph/check-import-graph.cjs --update-baseline',
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    `import-graph: OK (${baseline.direction.length} baselined direction violations, ` +
      `${baseline.cycles.length} baselined cycles; ${summary}; ${elapsed}s)`,
  );
}

if (require.main === module) main();

module.exports = {
  PACKAGES,
  TEST_FILE,
  buildGraph,
  directionViolations,
  normalizeCycle,
  findCycles,
  compareWithBaseline,
};
