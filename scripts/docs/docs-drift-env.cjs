/**
 * docs-drift-env
 *
 * The env-var rule of check-docs-drift: every env var rapitas-backend reads
 * must be in rapitas-backend/.env.example, ratcheted by env-baseline.json, and
 * doc-stated toolchain versions must match the pins.
 * Split out of check-docs-drift.cjs (file-size limit, task 1602); does no I/O.
 */

/**
 * Env var names read in source text via process.env / Bun.env.
 *
 * @param {string} src - Source text / ソース
 * @returns {string[]} Names / 変数名
 */
function envReads(src) {
  const names = new Set();
  for (const m of src.matchAll(
    /\b(?:process\.env|Bun\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]+)/g,
  )) {
    names.add(m[1]);
  }
  for (const m of src.matchAll(/\b(?:process\.env|Bun\.env)\[['"]([A-Z][A-Z0-9_]+)['"]\]/g)) {
    names.add(m[1]);
  }
  return [...names];
}

/**
 * Whether a repo file is backend production source the env rule covers.
 *
 * @param {string} f - Repo-relative path / リポジトリ相対パス
 * @returns {boolean} True when covered / 対象か
 */
function isBackendSource(f) {
  return (
    f.startsWith('rapitas-backend/') &&
    /\.ts$/.test(f) &&
    !/\.(test|spec)\.ts$/.test(f) &&
    !f.includes('/tests/') &&
    !f.includes('/generated/')
  );
}

/**
 * Env-var problems, each with the files that read the variable so a caller
 * can attribute it to a diff (task 1602).
 *
 * @param {{files: string[], read: (f: string) => string, example: string, baseline: string[]}} input - Repo files, reader, .env.example text, baseline names / 入力
 * @returns {{undocumented: string[], problems: {kind: string, name: string, readers: string[], message: string}[]}} Result / 結果
 */
function envProblems({ files, read, example, baseline }) {
  const readers = new Map();
  for (const f of files.filter(isBackendSource)) {
    for (const n of envReads(read(f))) {
      const list = readers.get(n) ?? [];
      list.push(f);
      readers.set(n, list);
    }
  }
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const undocumented = [...readers.keys()].filter((n) => !documented.has(n)).sort();
  const known = new Set(baseline);
  const problems = [];
  for (const n of undocumented) {
    if (known.has(n)) continue;
    problems.push({
      kind: 'env',
      name: n,
      readers: readers.get(n) ?? [],
      message: `env ${n} is read by rapitas-backend but missing from rapitas-backend/.env.example`,
    });
  }
  for (const n of known) {
    if (undocumented.includes(n)) continue;
    problems.push({
      kind: 'env-baseline',
      name: n,
      readers: readers.get(n) ?? [],
      message: `env ${n} is in scripts/docs/env-baseline.json but is now documented or no longer read — remove it from the baseline`,
    });
  }
  return { undocumented, problems };
}

/**
 * Toolchain versions stated in a doc that differ from the pins.
 *
 * @param {string} md - Markdown text / Markdown
 * @param {{node: string, bun: string, pnpm: string}} pins - Pinned versions / 固定バージョン
 * @returns {{tool: string, stated: string, pinned: string, line: number}[]} Mismatches / 不一致
 */
function versionMismatches(md, pins) {
  const out = [];
  const rules = [
    {
      tool: 'node',
      re: /\bNode(?:\.js)?\s+v?(\d+)(?:[.\dx]*)/g,
      pinned: pins.node,
      cmp: (s) => s === pins.node,
    },
    { tool: 'bun', re: /\bBun\s+v?(\d+\.\d+\.\d+)/g, pinned: pins.bun, cmp: (s) => s === pins.bun },
    {
      tool: 'pnpm',
      re: /\bpnpm\s+v?(\d+\.\d+\.\d+)/g,
      pinned: pins.pnpm,
      cmp: (s) => s === pins.pnpm,
    },
  ];
  md.split('\n').forEach((text, i) => {
    for (const r of rules) {
      for (const m of text.matchAll(r.re)) {
        if (!r.cmp(m[1])) out.push({ tool: r.tool, stated: m[1], pinned: r.pinned, line: i + 1 });
      }
    }
  });
  return out;
}

module.exports = { envReads, envProblems, isBackendSource, versionMismatches };
