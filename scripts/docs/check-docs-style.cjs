#!/usr/bin/env node
/**
 * check-docs-style
 *
 * Fails CI when a tracked Markdown doc breaks the machine-checkable part of
 * the documentation style rules (.claude/CLAUDE.md "Documentation style"):
 *   1. emoji    — no emoji or emoji-style status marks (✅ ❌ ⚠ ✓ ✗ ...);
 *                 good/bad examples and statuses are written as words;
 *   2. diagrams — no box-drawing diagrams; draw them as ```mermaid blocks.
 *                 Only corner/junction characters and drawn arrowheads count
 *                 (┌ ┐ ┘ ┬ ┴ ┼ ┤ ╔ ╗ ╚ ╝ ╭ ╮ ╯ ╰ ▼ ▲ ► ◄). A directory tree
 *                 uses ├ └ │ ─ only, so trees stay plain text and pass.
 * Not responsible for whether prose is clear or a diagram is correct; those
 * need review.
 *
 * Exempt: docs/archive/ (historical, kept as written). Exceptions — a symbol
 * that is literal UI or tool output being documented — live in
 * docs-style-ignore.json, each with a reason.
 *
 * Usage: node scripts/docs/check-docs-style.cjs
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const IGNORE_PATH = path.join(__dirname, 'docs-style-ignore.json');
const EXEMPT = [/^docs\/archive\//];

// NOTE: Emoji_Presentation alone misses ⚠ / ✔ (text-default symbols that turn
// into emoji with U+FE0F), and the bare check marks are not emoji at all but
// do the same decorative job, so they are listed explicitly.
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[✓✔✖✗✘⚠]/gu;
const DIAGRAM = /[┌┐┘┬┴┼┤╔╗╚╝╭╮╯╰▼▲►◄]/gu;

/**
 * Style violations in one Markdown document.
 *
 * @param {string} md - Markdown text / Markdown
 * @param {Set<string>} allowed - Characters this doc may use (from the ignore file) / 許可文字
 * @returns {{rule: 'emoji'|'diagram', char: string, line: number}[]} Violations / 違反
 */
function styleViolations(md, allowed = new Set()) {
  const out = [];
  md.split('\n').forEach((text, i) => {
    for (const [rule, re] of [
      ['emoji', EMOJI],
      ['diagram', DIAGRAM],
    ]) {
      for (const m of text.matchAll(re)) {
        const char = m[0].replace(/️/g, '');
        if (allowed.has(char)) continue;
        out.push({ rule, char, line: i + 1 });
      }
    }
  });
  return out;
}

/**
 * Build the per-file allow sets from the ignore file, rejecting entries
 * without a reason so an exception cannot be added silently.
 *
 * @param {{file: string, chars: string, reason: string}[]} entries - Ignore entries / 例外定義
 * @returns {Map<string, Set<string>>} Allowed characters per file / ファイル別許可文字
 * @throws {Error} When an entry has no reason / 理由のない例外がある場合
 */
function allowMap(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!e.file || !e.chars || !e.reason || !e.reason.trim()) {
      throw new Error(`docs-style-ignore.json: entry needs file, chars and reason: ${JSON.stringify(e)}`);
    }
    const set = map.get(e.file) || new Set();
    for (const c of e.chars.replace(/️/g, '')) set.add(c);
    map.set(e.file, set);
  }
  return map;
}

function main() {
  const files = execFileSync('git', ['ls-files', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((f) => f && !EXEMPT.some((re) => re.test(f)) && !f.includes('node_modules/'));
  const allow = allowMap(JSON.parse(fs.readFileSync(IGNORE_PATH, 'utf8')).exceptions);
  for (const f of allow.keys()) {
    if (!files.includes(f)) throw new Error(`docs-style-ignore.json names a file that is not checked: ${f}`);
  }
  const problems = [];
  for (const f of files) {
    const md = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const v of styleViolations(md, allow.get(f))) {
      const fix =
        v.rule === 'emoji'
          ? 'write it as a word (Good / Bad, 良い例 / 悪い例, 対応済み / 未対応) or a GitHub alert'
          : 'draw the diagram as a ```mermaid block';
      problems.push(`${f}:${v.line} ${v.rule} "${v.char}" — ${fix}`);
    }
  }
  if (problems.length) {
    console.error(`[docs-style] ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[docs-style] ok — ${files.length} docs checked`);
}

if (require.main === module) main();

module.exports = { styleViolations, allowMap, EMOJI, DIAGRAM };
