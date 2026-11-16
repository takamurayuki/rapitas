#!/usr/bin/env node
/**
 * check-docs-drift
 *
 * Fails CI when current documentation says something the code contradicts.
 * The code is the source of truth; this only checks claims that can be
 * decided mechanically:
 *   1. paths   — repo paths in backticks or relative links must exist;
 *   2. scripts — `npm|bun|pnpm run <name>` must be a package.json script;
 *   3. versions — Node / Bun / pnpm versions must match the pins in
 *                 .nvmrc and .github/toolchain.json;
 *   4. statuses — the status chains in the agent docs must use exactly the
 *                 values of WORKFLOW_STATUSES;
 *   5. env     — env vars the backend reads must be in .env.example, as a
 *                 ratchet: today's undocumented ones are listed in
 *                 env-baseline.json, a new one fails, and a baseline entry
 *                 that is now documented or unused fails until removed.
 * Not responsible for prose claims (counts, behaviour descriptions); those
 * need review, not a regex.
 *
 * Exempt: docs/archive/ (historical by definition), docs/adr/ and
 * docs/lessons/ (records of what was true then), and CHANGELOGs.
 *
 * Exists because (#1403) 59 doc paths resolved to nothing, .claude/CLAUDE.md
 * described a status flow the code does not have, setup docs pinned Node 20
 * against a pin of 24, and rapitas-backend/scripts/check-docs-health.ts —
 * the one doc check that existed — scanned 11 files and ran in no workflow.
 *
 * Usage: node scripts/docs/check-docs-drift.cjs [--update-env-baseline]
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const IGNORE_PATH = path.join(__dirname, 'docs-drift-ignore.json');
const ENV_BASELINE_PATH = path.join(__dirname, 'env-baseline.json');
const PACKAGE_ROOTS = ['', 'rapitas-backend', 'rapitas-frontend', 'rapitas-desktop'];
const EXEMPT = [/^docs\/archive\//, /^docs\/adr\//, /^docs\/lessons\//, /CHANGELOG\.md$/i];
const STATUS_DOCS = ['.claude/CLAUDE.md', 'AGENTS.md'];

// ── pure helpers (tested) ─────────────────────────────────────────────────────

/**
 * Remove fenced code blocks; their contents are examples, trees and shell
 * transcripts, not claims about the repository.
 *
 * @param {string} md - Markdown text / Markdown
 * @returns {string} Text without fenced blocks, line count preserved / フェンス除去後
 */
function stripFences(md) {
  let inFence = false;
  return md
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

/**
 * Path-like tokens a doc presents as repository paths.
 *
 * @param {string} md - Markdown text / Markdown
 * @returns {{token: string, line: number}[]} Candidates / パス候補
 */
function pathTokens(md) {
  const out = [];
  const lines = stripFences(md).split('\n');
  lines.forEach((text, i) => {
    const found = [];
    for (const m of text.matchAll(/`([^`\s]+)`/g)) found.push(m[1]);
    for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) found.push(m[1]);
    for (let t of found) {
      t = t.replace(/[.,;:]+$/, '').replace(/:\d+(-\d+)?$/, '');
      if (/^[a-z]+:\/\//i.test(t) || t.startsWith('mailto:')) continue;
      if (/[<>{}*$%|?=]|\.\.\.|…/.test(t)) continue; // placeholders, globs, flags
      if (t.startsWith('/') || t.startsWith('~') || t.startsWith('-') || t.startsWith('@'))
        continue;
      if (/^(\.[\w-]+)+$/.test(t)) continue; // an extension mention: `.tsx`, `.d.ts`, `.types.ts`
      // A path without an extension counts only when it ends in "/" (an
      // explicit directory): `bg-indigo-500/600`, `shadow-sm/md`,
      // `next/font` and `tasks/1/17` are classes, imports and URLs.
      const looksLikePath =
        /\.(ts|tsx|js|cjs|mjs|json|md|yml|yaml|prisma|rs|toml|sh|ps1|css)$/.test(t) ||
        (/^[\w.-]+\/([\w.-]+\/)*$/.test(t) && t.length > 2);
      if (looksLikePath) out.push({ token: t, line: i + 1 });
    }
  });
  return out;
}

/**
 * Whether a doc's path token resolves to a tracked file or directory.
 *
 * Exact first (relative to the repo root, the doc's directory, or a package
 * root). Docs also name files by their tail — `automated-verifier.ts`,
 * `ui/status-card/StatusCard.tsx` — so a tracked path ENDING in the token
 * counts too. That still catches the real failure: a file that moved
 * (`git-operations/worktree-ops.ts` → `git-operations/worktree/…`) or was
 * deleted has no path ending that way.
 *
 * @param {string} token - Path as written / 記載パス
 * @param {string} docPath - Repo-relative doc path / ドキュメントのパス
 * @param {{all: Set<string>, list: string[]}} tracked - Tracked files and directories / 追跡パス
 * @returns {boolean} True when it exists / 実在するか
 */
function resolves(token, docPath, tracked) {
  const clean = path.posix.normalize(token.replace(/^\.\//, '').replace(/\/$/, ''));
  if (clean === '.' || clean === '') return true;
  const docDir = path.posix.dirname(docPath);
  const bases = [docDir === '.' ? '' : docDir, ...PACKAGE_ROOTS];
  for (const base of bases) {
    const p = path.posix.normalize(base ? `${base}/${clean}` : clean);
    if (tracked.all.has(p)) return true;
  }
  if (clean.startsWith('..')) return false;
  const tail = `/${clean}`;
  return tracked.list.some((p) => p === clean || p.endsWith(tail));
}

/**
 * `npm|bun|pnpm run <name>` references whose script does not exist.
 *
 * @param {string} md - Markdown text, fences included (commands live there) / Markdown
 * @param {Set<string>} scripts - Every script name across package.json files / スクリプト名
 * @returns {{name: string, line: number}[]} Missing scripts / 存在しないスクリプト
 */
function missingScripts(md, scripts) {
  const out = [];
  md.split('\n').forEach((text, i) => {
    // `bun run scripts/x.ts` runs a file, not a script: skip names followed by "/".
    for (const m of text.matchAll(/\b(?:npm|bun|pnpm)\s+run\s+([\w:.-]+)(?![\w:./-])/g)) {
      if (/\.(c?js|mjs|ts|tsx)$/.test(m[1])) continue;
      if (!scripts.has(m[1])) out.push({ name: m[1], line: i + 1 });
    }
  });
  return out;
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

/**
 * Compare a doc's description of the workflow statuses with the code.
 *
 * `unknown`: a name inside a status chain ("a → b → c") that the code does
 * not have. `missing`: a status the code has that the doc never mentions —
 * the 2026-11 CLAUDE.md drift was exactly that (no verify_done, no
 * awaiting_question), so an agent reading it expected verify.md to complete
 * the task.
 *
 * @param {string} md - Markdown text / Markdown
 * @param {string[]} statuses - WORKFLOW_STATUSES / 正しいステータス
 * @returns {{unknown: string[], missing: string[]}} Differences / 差分
 */
function statusDrift(md, statuses) {
  const known = new Set(statuses);
  const inChains = new Set();
  for (const line of md.split('\n')) {
    if (!/→|->/.test(line)) continue;
    const ids = line.match(/\b[a-z]+(?:_[a-z]+)+\b|\bdraft\b|\bcompleted\b/g) || [];
    if (!ids.some((id) => known.has(id))) continue; // an unrelated arrow line
    for (const id of ids) inChains.add(id);
  }
  return {
    unknown: [...inChains].filter((s) => !known.has(s)).sort(),
    missing: statuses.filter((s) => !new RegExp(`\\b${s}\\b`).test(md)),
  };
}

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

// ── repository I/O ───────────────────────────────────────────────────────────

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function isGitIgnored(token, docPath) {
  const clean = token.replace(/^\.\//, '');
  const docDir = path.posix.dirname(docPath);
  const candidates = [clean, ...PACKAGE_ROOTS.filter(Boolean).map((r) => `${r}/${clean}`)];
  if (docDir !== '.') candidates.push(`${docDir}/${clean}`);
  for (const c of candidates) {
    try {
      execFileSync('git', ['check-ignore', '-q', '--no-index', c], { cwd: ROOT });
      return true;
    } catch {
      /* exit 1: not ignored */
    }
  }
  return false;
}

function main() {
  const updateBaseline = process.argv.includes('--update-env-baseline');
  const files = git(['ls-files']).trim().split('\n');
  const all = new Set(files);
  for (const f of files) {
    let d = path.posix.dirname(f);
    while (d !== '.' && !all.has(d)) {
      all.add(d);
      d = path.posix.dirname(d);
    }
  }
  const tracked = { all, list: [...all] };
  const ignore = JSON.parse(fs.readFileSync(IGNORE_PATH, 'utf8'));
  const ignoredTokens = new Set(ignore.paths);
  const exampleDocs = new Set(ignore.illustrativeNameDocs);
  const problems = [];

  const docs = files.filter(
    (f) => f.endsWith('.md') && !EXEMPT.some((re) => re.test(f)) && !f.includes('node_modules/'),
  );

  const scripts = new Set();
  for (const pkg of files.filter(
    (f) => /(^|\/)package\.json$/.test(f) && !f.includes('node_modules'),
  )) {
    try {
      for (const k of Object.keys(JSON.parse(read(pkg)).scripts || {})) scripts.add(k);
    } catch {
      /* not every package.json-named file is a manifest */
    }
  }
  const pins = { ...JSON.parse(read('.github/toolchain.json')), node: read('.nvmrc').trim() };

  for (const doc of docs) {
    const md = read(doc);
    for (const { token, line } of pathTokens(md)) {
      if (ignoredTokens.has(token)) continue;
      // Naming-policy docs illustrate with made-up file names; their real
      // paths (anything with a "/") are still checked.
      if (exampleDocs.has(doc) && !token.includes('/')) continue;
      if (resolves(token, doc, tracked)) continue;
      // Generated and runtime output (rapitas-backend/generated/,
      // rapitas-desktop/public/, .next/) is real but never tracked: a path
      // .gitignore covers is described, not stale.
      if (isGitIgnored(token, doc)) continue;
      problems.push(`${doc}:${line} path does not exist: ${token}`);
    }
    for (const { name, line } of missingScripts(md, scripts)) {
      problems.push(`${doc}:${line} no package.json script named "${name}"`);
    }
    for (const v of versionMismatches(md, pins)) {
      problems.push(`${doc}:${v.line} ${v.tool} ${v.stated} stated, pinned ${v.pinned}`);
    }
  }

  const typesSrc = read('rapitas-backend/services/workflow/workflow-types.ts');
  const block = /WORKFLOW_STATUSES\s*=\s*\[([\s\S]*?)\]/.exec(typesSrc);
  if (!block) throw new Error('WORKFLOW_STATUSES not found in workflow-types.ts');
  const statuses = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  for (const doc of STATUS_DOCS) {
    const { unknown, missing } = statusDrift(read(doc), statuses);
    if (unknown.length)
      problems.push(`${doc}: status chain names statuses the code lacks: ${unknown.join(', ')}`);
    if (missing.length)
      problems.push(`${doc}: status chain omits statuses the code has: ${missing.join(', ')}`);
  }

  const backendSrc = files.filter(
    (f) =>
      f.startsWith('rapitas-backend/') &&
      /\.ts$/.test(f) &&
      !/\.(test|spec)\.ts$/.test(f) &&
      !f.includes('/tests/') &&
      !f.includes('/generated/'),
  );
  const read_ = new Set();
  for (const f of backendSrc) for (const n of envReads(read(f))) read_.add(n);
  const example = read('rapitas-backend/.env.example');
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
  const undocumented = [...read_].filter((n) => !documented.has(n)).sort();
  if (updateBaseline) {
    const prev = JSON.parse(fs.readFileSync(ENV_BASELINE_PATH, 'utf8'));
    prev.undocumented = undocumented;
    fs.writeFileSync(ENV_BASELINE_PATH, `${JSON.stringify(prev, null, 2)}\n`);
    console.log(`[docs-drift] env baseline rewritten: ${undocumented.length} entries`);
    return;
  }
  const baseline = new Set(JSON.parse(fs.readFileSync(ENV_BASELINE_PATH, 'utf8')).undocumented);
  for (const n of undocumented) {
    if (!baseline.has(n)) {
      problems.push(
        `env ${n} is read by rapitas-backend but missing from rapitas-backend/.env.example`,
      );
    }
  }
  for (const n of baseline) {
    if (!undocumented.includes(n)) {
      problems.push(
        `env ${n} is in scripts/docs/env-baseline.json but is now documented or no longer read — remove it from the baseline`,
      );
    }
  }

  if (problems.length) {
    console.error(
      `[docs-drift] ${problems.length} problem(s) — the code is the source of truth; fix the doc:`,
    );
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[docs-drift] ok — ${docs.length} docs checked`);
}

if (require.main === module) main();

module.exports = {
  stripFences,
  pathTokens,
  resolves,
  missingScripts,
  versionMismatches,
  statusDrift,
  envReads,
};
