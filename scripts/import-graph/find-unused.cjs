/**
 * find-unused
 *
 * The pure part of check-unused-files.cjs: given one package's files, their
 * contents and the references from outside it, which files no entry point
 * reaches. Not responsible for reading the tree or the baseline — that is
 * check-unused-files.cjs, so these functions run on in-memory fixtures.
 */
const path = require('node:path');
const { extractImports, resolveSpecifier, stripNonCode, CODE_EXTS } = require('./scan-imports.cjs');

/** Path segments that are never part of the graph (build output, vendored, generated). */
const SKIP_DIR = /(^|\/)(node_modules|generated|\.next|\.next-tauri|dist|out|coverage|target)\//;
const TEST_DIR = /(?:^|\/)(?:__tests__|__mocks__|tests|test|e2e|__fixtures__|fixtures)\//;
const TEST_SUFFIX = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** Test-support files by name: shared mocks, setup, factories used only by tests. */
const TEST_HELPER =
  /(?:^|[/.-])(?:test-helpers?|test-utils?|testing|mocks?|setup-tests?|vitest\.setup)(?:[/.-]|$)/;

/** Text files (outside the graph) whose code-path mentions make a file a root. */
const REFERENCE_EXT = /\.(json|ya?ml|toml|txt|sh|ps1|rs|html|cjs|mjs|js|ts)$|(^|\/)\.husky\/[^/]+$/;
/** Code-file path token inside arbitrary text. */
const PATH_TOKEN = /[\w@.\-/]*[\w-]\.(?:tsx|ts|mts|cts|jsx|js|mjs|cjs)\b/g;
/** Quoted string literal that ends in a code extension. */
const STRING_PATH = /(['"`])([^'"`\s$]*?[\w-]\.(?:tsx|ts|mts|cts|jsx|js|mjs|cjs))\1/g;
/** Template-literal tail after an interpolation: `${root}/workers/x.mjs`. */
const TEMPLATE_TAIL_PATH = /\}\/([^'"`\s$]*?[\w-]\.(?:tsx|ts|mts|cts|jsx|js|mjs|cjs))`/g;

/**
 * Whether a package-relative path is a test, test fixture or test helper.
 *
 * @param {string} file - Package-relative posix path / パッケージ相対パス
 * @returns {boolean} True for test-only code / テスト専用なら true
 */
function isTestFile(file) {
  return TEST_DIR.test(file) || TEST_SUFFIX.test(file) || TEST_HELPER.test(file);
}

/**
 * Whether a file is never REPORTED even when unreachable. It still does not
 * make anything else reachable, so exempting it cannot hide a dead file.
 *   - `*.generated.*`: written by a generator, deleted by regenerating.
 *   - pure barrels (`index.*` holding only import/export-from lines, or an
 *     empty `export {}`):
 *     FOLDER_ORGANIZATION_POLICY.md requires one in every subdirectory, so an
 *     unused barrel is policy, not dead code. What it re-exports is judged
 *     on its own.
 *
 * @param {string} file - Package-relative posix path / パッケージ相対パス
 * @param {string} src - Source text / ソースコード
 * @returns {boolean} True when exempt from reporting / 報告対象外なら true
 */
function isExempt(file, src) {
  if (/\.generated\.[cm]?[jt]sx?$/.test(file)) return true;
  if (!/(^|\/)index\.[cm]?[jt]sx?$/.test(file)) return false;
  const statements = stripNonCode(src)
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean);
  // A `'use client'` directive is a statement too; it is not code.
  return statements.every(
    (x) =>
      /^(?:export|import)\b[\s\S]*\bfrom\s*['"][^'"]+['"]$/.test(x) ||
      /^['"]use \w+['"]$/.test(x) ||
      /^export\s*\{\s*\}$/.test(x),
  );
}

/**
 * Resolve a string that names a code file to package files.
 *
 * @param {string} token - The path text / パス文字列
 * @param {string[]} bases - Package-relative directories to resolve against ('' = package root) / 基準ディレクトリ
 * @param {Set<string>} files - All package-relative files / パッケージ内の全ファイル
 * @param {Map<string, string[]>} byBase - basename → files / ファイル名索引
 * @returns {string[]} Matching files / 一致したファイル
 */
function resolvePathToken(token, bases, files, byBase) {
  const t = token.replace(/^\.\//, '');
  if (!t.includes('/')) {
    // A bare name ('agent-worker.ts') is usually one segment of a join().
    // `index.*` is too common to mean anything on its own.
    if (/^index\./.test(t)) return [];
    return byBase.get(t) || [];
  }
  const out = new Set();
  for (const b of bases) {
    const p = path.posix.normalize(path.posix.join(b || '.', t));
    if (files.has(p)) out.add(p);
  }
  return [...out];
}

/**
 * Reachability analysis of one package.
 *
 * @param {object} pkg - A PACKAGES entry / パッケージ設定
 * @param {string[]} fileList - Package-relative posix paths / パッケージ内のファイル
 * @param {(file: string) => string} read - Reads a package-relative file / ファイル読み込み
 * @param {{prefix: string, targets: string[]}[]} aliases - tsconfig path aliases / エイリアス
 * @param {{source: string, text: string, dir: string|null}[]} externalRefs - Reference texts from outside the package; `dir` is the package-relative dir to resolve against, or null / 外部参照
 * @param {Set<string>} [extraRoots] - Package-relative files known to be entry points (e.g. scripts named in docs) / 追加の起点
 * @returns {{unused: string[], testOnly: string[], nodes: number, roots: number}} Unreachable in-scope files, and files only tests reach / 到達不能・テストからのみ到達するファイル
 */
function findUnused(pkg, fileList, read, aliases, externalRefs, extraRoots = new Set()) {
  const files = new Set(fileList.filter((f) => !SKIP_DIR.test(f)));
  const code = [...files].filter((f) => CODE_EXTS.includes(path.posix.extname(f))).sort();
  const byBase = new Map();
  for (const f of code) {
    const b = path.posix.basename(f);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(f);
  }
  const codeSet = new Set(code);
  const tokenTargets = (token, bases) =>
    resolvePathToken(token, bases, codeSet, byBase).filter((x) => codeSet.has(x));

  const edges = new Map(code.map((f) => [f, new Set()]));
  for (const file of code) {
    const src = read(file);
    for (const { spec } of extractImports(src)) {
      const to = resolveSpecifier(file, spec, files, aliases);
      if (to && to !== file) edges.get(file).add(to);
    }
    const literals = stripNonCode(src, { keepTemplates: true });
    const tokens = [];
    for (let m; (m = STRING_PATH.exec(literals)); ) tokens.push(m[2]);
    for (let m; (m = TEMPLATE_TAIL_PATH.exec(literals)); ) tokens.push(m[1]);
    for (const token of tokens) {
      for (const to of tokenTargets(token, [path.posix.dirname(file), ''])) {
        if (to !== file) edges.get(file).add(to);
      }
    }
  }

  const roots = new Set();
  for (const f of code) {
    if (f.endsWith('.d.ts') || isTestFile(f) || pkg.entries.some((re) => re.test(f))) roots.add(f);
  }
  for (const f of [...Object.keys(pkg.explicit), ...extraRoots]) if (codeSet.has(f)) roots.add(f);
  // In-package non-code files (package.json, bunfig.toml, gate lists, manifests).
  const localRefs = [...files]
    .filter((f) => !codeSet.has(f) && REFERENCE_EXT.test(f) && !/\.lock$|lock\.ya?ml$/.test(f))
    .map((f) => ({ text: read(f), dir: path.posix.dirname(f) }));
  for (const { text, dir } of [...localRefs, ...externalRefs]) {
    for (const m of text.match(PATH_TOKEN) || []) {
      const bases = dir === null ? [''] : [dir, ''];
      for (const to of tokenTargets(m, bases)) roots.add(to);
    }
  }

  const reach = (start) => {
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) {
      for (const to of edges.get(queue.pop()) || []) {
        if (!seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    return seen;
  };
  const seen = reach(roots);
  // Informational only: production files that only tests (or test helpers) reach.
  const prodSeen = reach([...roots].filter((f) => !isTestFile(f)));
  const inScope = (f) => pkg.scope.some((s) => f.startsWith(s));
  const report = (f) => inScope(f) && !isTestFile(f) && !isExempt(f, read(f));
  const unused = code.filter((f) => !seen.has(f) && report(f)).map((f) => `${pkg.name}/${f}`);
  const testOnly = code
    .filter((f) => seen.has(f) && !prodSeen.has(f) && !roots.has(f) && report(f))
    .map((f) => `${pkg.name}/${f}`);
  return { unused, testOnly, nodes: code.length, roots: roots.size };
}

/**
 * Compare the current findings with the baseline.
 *
 * @param {string[]} current - Unreachable now / 現在の到達不能ファイル
 * @param {string[]} baseline - Recorded / ベースライン
 * @returns {{added: string[], stale: string[]}} Diff / 差分
 */
function compareWithBaseline(current, baseline) {
  const now = new Set(current);
  const then = new Set(baseline);
  return {
    added: current.filter((x) => !then.has(x)),
    stale: [...then].filter((x) => !now.has(x)).sort(),
  };
}

/**
 * External references for one package: a token naming `<pkg>/x.ts` (directly
 * or relative to the referencing file) becomes `x.ts` resolved from the
 * package root. From a repo-level file (a workflow with
 * `working-directory: <pkg>`), a bare `scripts/x.ts` is tried as well.
 * The package's own files are skipped — the graph already covers them.
 *
 * @param {string} pkgName - Package directory name / パッケージ名
 * @param {{source: string, text: string, pkg: string|null}[]} texts - From referenceTexts / 参照テキスト
 * @returns {{source: string, text: string, dir: null}[]} Rewritten references / 参照
 */
function externalRefsFor(pkgName, texts) {
  const out = [];
  for (const { source, text, pkg } of texts) {
    if (pkg === pkgName) continue;
    const tokens = [];
    for (const m of text.match(PATH_TOKEN) || []) {
      const t = m.replace(/^\.\//, '');
      const fromDir = path.posix.normalize(path.posix.join(path.posix.dirname(source), t));
      for (const cand of [t, fromDir]) {
        const i = cand.indexOf(`${pkgName}/`);
        if (i === 0 || (i > 0 && cand[i - 1] === '/'))
          tokens.push(cand.slice(i + pkgName.length + 1));
      }
      // `working-directory: rapitas-backend` + `bun scripts/x.ts`: a bare
      // package-relative path. Try it against the package root as well.
      if (pkg === null && t.includes('/') && !t.startsWith('.')) tokens.push(t);
    }
    if (tokens.length) out.push({ source, text: tokens.join('\n'), dir: null });
  }
  return out;
}

module.exports = {
  SKIP_DIR,
  REFERENCE_EXT,
  isTestFile,
  isExempt,
  resolvePathToken,
  findUnused,
  externalRefsFor,
  compareWithBaseline,
};
