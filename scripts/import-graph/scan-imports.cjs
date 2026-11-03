/**
 * scan-imports
 *
 * Extracts import specifiers from TS/JS source and resolves them to files,
 * for check-import-graph.cjs. Dependency-free on purpose: installs are not
 * allowed in worktrees, and the lint job runs this before any `node_modules`
 * exists, so it cannot lean on the TypeScript compiler.
 * Not responsible for deciding what is a violation — only for the edges.
 */
const path = require('node:path');

/** Extensions tried, in order, for an extensionless or `.js` specifier. */
const CODE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = /\b(return|typeof|case|in|of|delete|void|throw|new|yield|await|else|do)$/;

/**
 * Blank out comments, template literals and regex literals, keeping quoted
 * strings intact (import specifiers live in them).
 *
 * NOTE: Template literals are blanked because generated-code templates and
 * test fixtures contain text like `import x from './y'` that is not an import.
 * Quoted strings stop at a newline so one stray JSX apostrophe ("Don't") can
 * swallow at most the rest of its line, not the rest of the file.
 *
 * @param {string} src - Source text / ソースコード
 * @returns {string} Same-length text with non-code regions as spaces / 同じ長さの空白化済みテキスト
 */
function stripNonCode(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  let lastSig = '';
  let lastWord = '';
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      i = j + 1;
      lastSig = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === '\\') j += 2;
        else if (depth === 0 && src[j] === '`') break;
        else if (src[j] === '$' && src[j + 1] === '{') {
          depth++;
          j += 2;
        } else if (depth > 0 && src[j] === '}') {
          depth--;
          j++;
        } else j++;
      }
      blank(i, j + 1);
      i = j + 1;
      lastSig = '`';
      continue;
    }
    if (c === '/') {
      // A slash after an operator, an opening bracket or a keyword such as
      // `return` starts a regex; after an identifier or `)` it is division.
      const isRegex =
        lastSig === '' ||
        REGEX_PRECEDERS.has(lastSig) ||
        (lastSig === 'w' && REGEX_KEYWORDS.test(lastWord));
      if (isRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== '\n') {
          if (src[j] === '\\') j += 2;
          else if (src[j] === '[') {
            inClass = true;
            j++;
          } else if (src[j] === ']') {
            inClass = false;
            j++;
          } else if (src[j] === '/' && !inClass) break;
          else j++;
        }
        blank(i, j + 1);
        i = j + 1;
        lastSig = '/';
        continue;
      }
    }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j])) j++;
      lastSig = 'w';
      lastWord = src.slice(i, j);
      i = j;
      continue;
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return out.join('');
}

/**
 * Whether an import/export clause brings in types only (erased at runtime).
 *
 * @param {string} clause - Text between `import`/`export` and `from` / 句のテキスト
 * @returns {boolean} True for `type X`, `type { A }`, `{ type A, type B }` / 型のみなら true
 */
function isTypeOnlyClause(clause) {
  const c = clause.trim();
  if (/^type\b/.test(c) && !/^type\s*,/.test(c)) return true;
  const m = /^\{([\s\S]*)\}$/.exec(c);
  if (!m) return false;
  const specs = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return specs.length > 0 && specs.every((s) => /^type\s/.test(s));
}

/**
 * List the module specifiers a source file depends on.
 *
 * @param {string} src - Source text / ソースコード
 * @returns {{spec: string, kind: 'static'|'type'|'dynamic'}[]} Imports in source order / インポート一覧
 */
function extractImports(src) {
  const code = stripNonCode(src);
  const found = [];
  const fromRe =
    /(?:^|[^\w$.])(import|export)\s+((?:(?!\b(?:import|export)\b)[^'";])*?)\s*\bfrom\s*(['"])([^'"\n]+)\3/g;
  for (let m; (m = fromRe.exec(code)); ) {
    const clause = m[2];
    // `export const from = 'x'` style false positives have `=` or parens in the clause.
    if (/[=()]/.test(clause)) continue;
    found.push({ index: m.index, spec: m[4], kind: isTypeOnlyClause(clause) ? 'type' : 'static' });
  }
  const bareRe = /(?:^|[^\w$.])import\s*(['"])([^'"\n]+)\1/g;
  for (let m; (m = bareRe.exec(code)); ) found.push({ index: m.index, spec: m[2], kind: 'static' });
  const requireRe = /(?:^|[^\w$.])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
  for (let m; (m = requireRe.exec(code)); )
    found.push({ index: m.index, spec: m[2], kind: 'static' });
  const dynRe = /(?:^|[^\w$.])import\s*\(\s*(['"])([^'"\n]+)\1/g;
  for (let m; (m = dynRe.exec(code)); ) found.push({ index: m.index, spec: m[2], kind: 'dynamic' });
  return found.sort((a, b) => a.index - b.index).map(({ spec, kind }) => ({ spec, kind }));
}

/**
 * Read `compilerOptions.paths` from a tsconfig (JSON with comments).
 *
 * @param {string} text - tsconfig.json contents / tsconfig の内容
 * @param {string} dir - Package-relative dir of the tsconfig ('' = package root) / tsconfig の位置
 * @returns {{prefix: string, targets: string[]}[]} Alias prefixes → package-relative target prefixes / エイリアス一覧
 */
function parseTsconfigAliases(text, dir) {
  const json = JSON.parse(stripNonCode(text.replace(/`/g, ' ')).replace(/,(\s*[}\]])/g, '$1'));
  const opts = json.compilerOptions || {};
  const base = path.posix.join(dir || '.', opts.baseUrl || '.');
  const aliases = [];
  for (const [key, targets] of Object.entries(opts.paths || {})) {
    if (!key.endsWith('*')) continue;
    aliases.push({
      prefix: key.slice(0, -1),
      targets: targets.map((t) => path.posix.join(base, t.replace(/\*$/, ''))),
    });
  }
  return aliases;
}

/**
 * Resolve a specifier to a package-relative file, or null for packages,
 * assets and anything that does not exist.
 *
 * @param {string} fromFile - Importing file, package-relative posix path / インポート元
 * @param {string} rawSpec - The specifier (a `?query` suffix is ignored) / 指定子
 * @param {Set<string>} files - All package-relative files / パッケージ内の全ファイル
 * @param {{prefix: string, targets: string[]}[]} aliases - From parseTsconfigAliases / エイリアス
 * @returns {string|null} Resolved file / 解決先
 */
function resolveSpecifier(fromFile, rawSpec, files, aliases) {
  // Tests import `./mod?restart=1` to get a fresh module instance.
  const spec = rawSpec.replace(/\?.*$/, '');
  let bases;
  if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
    bases = [path.posix.join(path.posix.dirname(fromFile), spec)];
  } else {
    const alias = aliases.find((a) => spec.startsWith(a.prefix));
    if (!alias) return null;
    bases = alias.targets.map((t) => path.posix.join(t, spec.slice(alias.prefix.length)));
  }
  for (const raw of bases) {
    const base = raw.replace(/\/$/, '');
    if (files.has(base) && CODE_EXTS.includes(path.posix.extname(base))) return base;
    // ESM-style `./x.js` that is really `./x.ts`.
    const stem = /\.[mc]?jsx?$/.test(base) ? base.replace(/\.[mc]?jsx?$/, '') : null;
    for (const candidate of stem ? [base, stem] : [base]) {
      for (const ext of CODE_EXTS) if (files.has(candidate + ext)) return candidate + ext;
    }
    for (const ext of CODE_EXTS) if (files.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
  }
  return null;
}

module.exports = {
  CODE_EXTS,
  stripNonCode,
  isTypeOnlyClause,
  extractImports,
  parseTsconfigAliases,
  resolveSpecifier,
};
