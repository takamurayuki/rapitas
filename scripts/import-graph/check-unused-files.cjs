#!/usr/bin/env node
/**
 * check-unused-files
 *
 * Fails CI when a source file becomes unreachable: no entry point reaches it
 * through imports or through a string path that names it. A ratchet like
 * check-import-graph: today's unreachable files are listed in
 * unused-files-baseline.json, a file not listed fails, and a listed file that
 * is reachable again (or deleted) also fails until it is removed, so the
 * baseline can only shrink.
 * Not responsible for unused EXPORTS inside a used file — knip.yml (advisory)
 * covers those for the frontend.
 *
 * Reachability:
 *   - Edges are every import form scan-imports.cjs extracts (static,
 *     type-only, dynamic, require) PLUS string literals that name a code file
 *     (`new URL('./w.ts', import.meta.url)`, `join(dir, 'workers', 'x.ts')`,
 *     a spawn argument, a vitest `setupFiles` entry). A bare file name such as
 *     'agent-worker.ts' matches every package file with that name.
 *   - Roots are the ENTRY rules of each package (framework entry files,
 *     configs, tests and test helpers, `*.d.ts`), the EXPLICIT list (files a
 *     runtime loads by a computed path no literal names), every code path
 *     named in a non-code reference file (package.json, workflows, hooks,
 *     bunfig.toml, gate lists *.txt, tauri config) or in another package /
 *     root scripts/, and every file under a `scripts/` dir whose name any
 *     tracked file mentions (see mentionedScripts).
 *     Otherwise Markdown is NOT a reference: a doc naming a module does not
 *     load it.
 *   - Pure barrels and `*.generated.*` are never reported (see isExempt).
 *   The graph logic is in find-unused.cjs; this file reads the tree.
 *
 * Usage: node scripts/import-graph/check-unused-files.cjs [--update-baseline] [--list]
 *   --update-baseline rewrites the baseline; it is for SHRINKING after a
 *   deletion and warns loudly when it would add entries.
 *   --list prints every unreachable file, baselined or not.
 *   --list-test-only prints production files that ONLY tests reach. Not
 *   gated (a tested-but-unwired module is sometimes work in progress), but
 *   it is where dead code hides once its last caller goes: the test keeps
 *   it "reachable". Review it when cleaning up.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { parseTsconfigAliases, CODE_EXTS } = require('./scan-imports.cjs');
const {
  SKIP_DIR,
  REFERENCE_EXT,
  isTestFile,
  isExempt,
  resolvePathToken,
  findUnused,
  externalRefsFor,
  compareWithBaseline,
} = require('./find-unused.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_REL = 'scripts/import-graph/unused-files-baseline.json';
const BASELINE_PATH = path.join(ROOT, BASELINE_REL);

/**
 * Packages checked. `scope` limits which files may be REPORTED (everything
 * in the package is still in the graph, so a config outside scope can make a
 * file inside it reachable). `entries` are regexes on package-relative paths.
 * `explicit` are roots no literal in the tree names — each needs a reason.
 */
const PACKAGES = [
  {
    name: 'rapitas-backend',
    scope: [''],
    entries: [
      /^(index|server-entry|server-main|register-routes|prisma\.config|global\.d)\.ts$/,
      /^eslint\.config\.mjs$/,
    ],
    explicit: {},
  },
  {
    name: 'rapitas-frontend',
    scope: ['src/'],
    entries: [
      // Next.js app router special files (https://nextjs.org/docs/app/api-reference/file-conventions).
      /^src\/app\/(?:.*\/)?(?:page|layout|template|loading|error|global-error|not-found|forbidden|unauthorized|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.[jt]sx?$/,
      /^src\/(?:middleware|proxy|instrumentation|instrumentation-client)\.[jt]s$/,
      /^(?:next|vitest|eslint|postcss|tailwind)\.config\.[cm]?[jt]s$/,
    ],
    explicit: {},
  },
  {
    name: 'rapitas-desktop',
    scope: ['scripts/'],
    entries: [],
    explicit: {},
  },
];

function gitFiles(cwd) {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '.'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split('\n')
    .filter(Boolean)
    .filter((f) => fs.existsSync(path.join(cwd, f)));
}

/**
 * Reference texts for cross-package and repo-level references: workflows,
 * hooks, root scripts and configs, and every package's code and config (a
 * frontend eslint config imports `../rapitas-backend/eslint-rules/x.mjs`).
 *
 * @param {string[]} repoFiles - Repo-relative tracked files / 追跡ファイル
 * @returns {{source: string, text: string, pkg: string|null}[]} Reference texts and the package each belongs to / 参照テキスト
 */
function referenceTexts(repoFiles) {
  return (
    repoFiles
      .filter((f) => !SKIP_DIR.test(f) && !f.startsWith('docs/') && REFERENCE_EXT.test(f))
      .filter((f) => !/\.lock$|lock\.ya?ml$/.test(f))
      // The baseline names every unreachable file; letting it count as a
      // reference would make each baselined file reachable and the entry stale.
      .filter((f) => f !== BASELINE_REL)
      .map((f) => ({
        source: f,
        text: fs.readFileSync(path.join(ROOT, f), 'utf8'),
        pkg: (PACKAGES.find((p) => f.startsWith(`${p.name}/`)) || {}).name || null,
      }))
  );
}

/**
 * Script files (anything under a `scripts/` directory) whose name another
 * file mentions — a package.json script, a workflow, a doc telling a human to
 * run it, a comment pointing at it. Scripts are command-line entry points, so
 * this mirrors the rule check-repo-hygiene.cjs applies to top-level scripts:
 * a doc is a legitimate way to invoke one. The full file name is searched,
 * and the extensionless stem only when it contains a `-` (a stem like `dev`
 * would match everything).
 *
 * @param {string} pkgName - Package directory name / パッケージ名
 * @param {string[]} files - Package-relative files / パッケージ内のファイル
 * @returns {Set<string>} Mentioned script files, package-relative / 言及されたスクリプト
 */
function mentionedScripts(pkgName, files) {
  const scripts = files.filter(
    (f) =>
      /(^|\/)scripts\//.test(f) &&
      !SKIP_DIR.test(f) &&
      !isTestFile(f) &&
      CODE_EXTS.includes(path.posix.extname(f)),
  );
  const needlesOf = (f) => {
    const base = path.posix.basename(f);
    const stem = base.replace(/\.[^.]+$/, '');
    return stem.includes('-') ? [base, stem] : [base];
  };
  const needles = [...new Set(scripts.flatMap(needlesOf))];
  if (!needles.length) return new Set();
  let out = '';
  try {
    out = execFileSync(
      'git',
      [
        'grep',
        '--untracked',
        '-o',
        '-F',
        ...needles.flatMap((n) => ['-e', n]),
        '--',
        '.',
        ':!*.lock',
        ':!**/pnpm-lock.yaml',
        `:!${BASELINE_REL}`,
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
  } catch (err) {
    if (err.status !== 1) throw err; // 1 = no match
  }
  const hitsBy = new Map();
  for (const line of out.split('\n')) {
    const i = line.lastIndexOf(':');
    if (i < 0) continue;
    const [file, needle] = [line.slice(0, i), line.slice(i + 1)];
    if (!hitsBy.has(needle)) hitsBy.set(needle, new Set());
    hitsBy.get(needle).add(file);
  }
  const mentioned = new Set();
  for (const f of scripts) {
    const repoPath = `${pkgName}/${f}`;
    const stemPath = repoPath.replace(/\.[^./]+$/, '');
    const isSelf = (x) =>
      x === repoPath || x.startsWith(`${stemPath}.test.`) || x.startsWith(`${stemPath}.spec.`);
    if (needlesOf(f).some((n) => [...(hitsBy.get(n) || [])].some((x) => !isSelf(x))))
      mentioned.add(f);
  }
  return mentioned;
}

/**
 * Analyse every package from the working tree.
 *
 * @returns {{unused: string[], testOnly: string[], stats: object}} Findings / 検出結果
 */
function analyzeRepo() {
  const texts = referenceTexts(gitFiles(ROOT));
  const unused = [];
  const testOnly = [];
  const stats = {};
  for (const pkg of PACKAGES) {
    const pkgRoot = path.join(ROOT, pkg.name);
    const tsconfig = path.join(pkgRoot, 'tsconfig.json');
    const aliases = fs.existsSync(tsconfig)
      ? parseTsconfigAliases(fs.readFileSync(tsconfig, 'utf8'), '')
      : [];
    const files = gitFiles(pkgRoot);
    const r = findUnused(
      pkg,
      files,
      (f) => fs.readFileSync(path.join(pkgRoot, f), 'utf8'),
      aliases,
      externalRefsFor(pkg.name, texts),
      mentionedScripts(pkg.name, files),
    );
    unused.push(...r.unused);
    testOnly.push(...r.testOnly);
    stats[pkg.name] = { files: r.nodes, roots: r.roots, unused: r.unused.length };
  }
  return { unused: unused.sort(), testOnly: testOnly.sort(), stats };
}

function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return [];
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).unused || [];
}

function main() {
  const started = Date.now();
  const current = analyzeRepo();
  const baseline = readBaseline();
  const diff = compareWithBaseline(current.unused, baseline);
  const summary = Object.entries(current.stats)
    .map(([n, s]) => `${n}: ${s.files} files, ${s.roots} roots, ${s.unused} unreachable`)
    .join('; ');

  if (process.argv.includes('--list-test-only')) {
    for (const f of current.testOnly) console.log(f);
    return;
  }
  if (process.argv.includes('--list')) {
    for (const f of current.unused) console.log(f);
    return;
  }
  if (process.argv.includes('--update-baseline')) {
    if (diff.added.length) {
      console.warn('!!! WARNING: --update-baseline is ADDING entries to the baseline. !!!');
      console.warn('!!! The baseline is meant to shrink. Delete these or make them reachable: !!!');
      for (const x of diff.added) console.warn(`  + ${x}`);
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify({ unused: current.unused }, null, 2)}\n`);
    console.log(
      `unused-files: baseline written (${current.unused.length} files; ` +
        `-${diff.stale.length} +${diff.added.length}).`,
    );
    return;
  }

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const lines = [
    ...diff.added.map((x) => `  NEW unreachable file   ${x}`),
    ...diff.stale.map((x) => `  STALE baseline entry   ${x}`),
  ];
  if (lines.length) {
    console.error(`unused-files: ${lines.length} problem(s) (${summary}; ${elapsed}s)`);
    console.error(lines.join('\n'));
    if (diff.added.length) {
      console.error(
        '\nNEW entries: nothing imports or names these files. Delete them, import them, or — if a ' +
          'runtime loads one by a computed path — add it to `explicit` in ' +
          'scripts/import-graph/check-unused-files.cjs with the reason. Do not add it to the baseline.',
      );
    }
    if (diff.stale.length) {
      console.error(
        '\nSTALE entries were deleted or are used again. Shrink the baseline: ' +
          'node scripts/import-graph/check-unused-files.cjs --update-baseline',
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(`unused-files: OK (${baseline.length} baselined; ${summary}; ${elapsed}s)`);
}

if (require.main === module) main();

module.exports = {
  PACKAGES,
  isTestFile,
  isExempt,
  resolvePathToken,
  findUnused,
  compareWithBaseline,
  externalRefsFor,
};
