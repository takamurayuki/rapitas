/**
 * gen-boundary-guide
 *
 * Reads tests/helpers/boundary-values.ts (SSOT) and generates
 * docs/boundary-guide.generated.md — a human-readable reference guide
 * for all boundary value constants used in resolver tests.
 *
 * Usage:
 *   bun run gen:boundary-guide                          # (re)generate the guide
 *   bun run gen:boundary-guide --check                  # exit 1 if drift detected
 *   bun run gen:boundary-guide --check --files=a,b     # skip if SSOT not in changed files
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  STRING_EDGES,
  ID_EDGES,
  NUMERIC_ID_BOUNDARIES,
  BOUNDARY_STRINGS,
  TIME_BOUNDARIES,
  NULLABLE_ID_EDGES,
  INVALID_ID_EDGES,
  NONEXISTENT_ID,
} from '../tests/helpers/boundary-values';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Relative path of the SSOT file — used for --files comparison. */
export const SSOT_RELATIVE = 'tests/helpers/boundary-values.ts';
/** Absolute path to the generated guide document. */
export const GUIDE_PATH = join(ROOT, 'docs', 'boundary-guide.generated.md');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Single boundary case entry (structural match for BoundaryCase<T>). */
export interface BoundaryCaseEntry {
  readonly label: string;
  readonly value: string | number | null;
  readonly note?: string;
}

/** Input type for guide generation — mirrors exports of boundary-values.ts. */
export interface BoundaryGuideInput {
  STRING_EDGES: readonly BoundaryCaseEntry[];
  ID_EDGES: readonly BoundaryCaseEntry[];
  NUMERIC_ID_BOUNDARIES: readonly BoundaryCaseEntry[];
  BOUNDARY_STRINGS: readonly BoundaryCaseEntry[];
  TIME_BOUNDARIES: readonly BoundaryCaseEntry[];
  NULLABLE_ID_EDGES: readonly BoundaryCaseEntry[];
  INVALID_ID_EDGES: readonly BoundaryCaseEntry[];
  NONEXISTENT_ID: number;
}

/** Represents a file that is out of sync with the generated output. */
export interface DriftResult {
  file: string;
  status: 'missing' | 'mismatch';
}

// ---------------------------------------------------------------------------
// CLI arg parsing (same interface as gen-resolver-boundary-tests.ts)
// ---------------------------------------------------------------------------

/**
 * Parses the `--files` CLI argument.
 *
 * @param argv - `process.argv` or equivalent / コマンドライン引数配列
 * @returns Parsed file paths, `[]` for empty flag, or `null` when flag is absent
 */
export function parseFilesArg(argv: string[]): string[] | null {
  const idx = argv.findIndex((a) => a === '--files' || a.startsWith('--files='));
  if (idx === -1) return null;

  const arg = argv[idx];
  if (arg.startsWith('--files=')) {
    const val = arg.slice('--files='.length);
    return val
      ? val
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : [];
  }

  const files: string[] = [];
  for (let i = idx + 1; i < argv.length; i++) {
    if (argv[i].startsWith('-')) break;
    files.push(argv[i]);
  }
  return files;
}

/**
 * Returns true when the SSOT file appears in the changed-files list.
 * Matches both full path suffixes and the relative path.
 *
 * @param files - List of changed file paths from git diff / 変更ファイルリスト
 * @returns Whether the SSOT is among the changed files
 */
export function isSsotChanged(files: string[]): boolean {
  return files.some(
    (f) =>
      f === SSOT_RELATIVE ||
      f.endsWith('/' + SSOT_RELATIVE) ||
      f.replace(/\\/g, '/').endsWith('/' + SSOT_RELATIVE),
  );
}

// ---------------------------------------------------------------------------
// Content generation
// ---------------------------------------------------------------------------

/**
 * Renders a boundary value for Markdown display.
 *
 * @param value - The boundary value to render / レンダリング対象の境界値
 * @returns Inline code string for use in Markdown tables
 */
export function renderValue(value: string | number | null): string {
  if (value === null) return '`null`';
  if (typeof value === 'number') return `\`${value}\``;
  const escaped = value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');
  if (escaped === '') return '`""` (空文字)';
  return `\`"${escaped}"\``;
}

/**
 * Generates a Markdown table for a list of boundary cases.
 *
 * @param cases - Array of boundary case entries / 境界値ケース配列
 * @returns Markdown table string
 */
function renderTable(cases: readonly BoundaryCaseEntry[]): string {
  const rows = cases
    .map((c) => `| ${c.label} | ${renderValue(c.value)} | ${c.note ?? ''} |`)
    .join('\n');
  return `| ラベル | 値 | 補足 |\n| --- | --- | --- |\n${rows}`;
}

/**
 * Generates the Markdown guide content from boundary value constants.
 *
 * @param input - Boundary value constants from boundary-values.ts / 境界値定数
 * @returns Markdown string for docs/boundary-guide.generated.md
 */
export function generateGuideContent(input: BoundaryGuideInput): string {
  return (
    `# Resolver 境界値ガイド\n` +
    `\n` +
    `> 自動生成ファイル — \`bun run gen:boundary-guide\` で再生成。手動編集不可。  \n` +
    `> ソース: \`scripts/gen-boundary-guide.ts\`  \n` +
    `> SSOT: \`${SSOT_RELATIVE}\`\n` +
    `\n` +
    `## 概要\n` +
    `\n` +
    `\`${SSOT_RELATIVE}\` に定義された境界値定数のリファレンス。\n` +
    `\`it.each\` / \`test.each\` パターンで resolver の境界値テストを記述する際に使用する。\n` +
    `\n` +
    `## BoundaryCase\\<T\\> 型\n` +
    `\n` +
    `| フィールド | 型 | 説明 |\n` +
    `| --- | --- | --- |\n` +
    `| \`label\` | \`string\` | テスト名 (\`%s\` / \`$label\`) に表示される識別子 |\n` +
    `| \`value\` | \`T\` | 境界値の実値 |\n` +
    `| \`note\` | \`string \\| undefined\` | 補足・制約（省略可） |\n` +
    `\n` +
    `## 定数一覧\n` +
    `\n` +
    `### \`STRING_EDGES\`\n` +
    `\n` +
    `文字列引数 resolver 向けの境界値（空文字・空白系）。\n` +
    `\n` +
    renderTable(input.STRING_EDGES) +
    `\n\n` +
    `### \`ID_EDGES\`\n` +
    `\n` +
    `数値 ID 引数 resolver 向けの境界値（0 / -1 / 1 の小規模セット）。\n` +
    `\n` +
    renderTable(input.ID_EDGES) +
    `\n\n` +
    `### \`NUMERIC_ID_BOUNDARIES\`\n` +
    `\n` +
    `数値型 ID の境界値セット（\`ID_EDGES\` の拡張版 — \`MAX_SAFE_INTEGER\` を含む）。\n` +
    `\n` +
    renderTable(input.NUMERIC_ID_BOUNDARIES) +
    `\n\n` +
    `### \`BOUNDARY_STRINGS\`\n` +
    `\n` +
    `文字列型フィールドの境界値セット（改行を含む）。\n` +
    `\n` +
    renderTable(input.BOUNDARY_STRINGS) +
    `\n\n` +
    `### \`TIME_BOUNDARIES\`\n` +
    `\n` +
    `時刻（epoch ミリ秒）の境界値セット。\n` +
    `\n` +
    renderTable(input.TIME_BOUNDARIES) +
    `\n\n` +
    `### \`NULLABLE_ID_EDGES\`\n` +
    `\n` +
    `nullable 数値 ID 引数 resolver 向けの境界値定数（\`ID_EDGES\` + \`null\`）。\n` +
    `\n` +
    renderTable(input.NULLABLE_ID_EDGES) +
    `\n\n` +
    `### \`INVALID_ID_EDGES\`\n` +
    `\n` +
    `バリデーションで拒否されるべき非正 ID の境界値セット（0 / -1）。\n` +
    `\n` +
    renderTable(input.INVALID_ID_EDGES) +
    `\n\n` +
    `### \`NONEXISTENT_ID\`\n` +
    `\n` +
    `DB に存在しないことを表すセンチネル ID。mock が null を返す前提の「存在しない ID」として使用する。\n` +
    `\n` +
    `| 値 |\n` +
    `| --- |\n` +
    `| \`${input.NONEXISTENT_ID}\` |\n` +
    `\n` +
    `## ユーティリティ関数\n` +
    `\n` +
    `### \`toNameTuples<T>(cases)\`\n` +
    `\n` +
    `\`BoundaryCase<T>[]\` を \`it.each\` 用 \`[label, value]\` タプル配列に変換する。\n` +
    `bun:test の \`%s\` 置換は primitive 前提のため、本関数でタプル化することで\n` +
    `ラベルを正しく表示できる。\n`
  );
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/**
 * Compares the expected generated guide against what is on disk.
 *
 * @returns Array of DriftResult for each out-of-sync file (empty = no drift)
 */
export function checkDrift(): DriftResult[] {
  const expected = generateGuideContent({
    STRING_EDGES,
    ID_EDGES,
    NUMERIC_ID_BOUNDARIES,
    BOUNDARY_STRINGS,
    TIME_BOUNDARIES,
    NULLABLE_ID_EDGES,
    INVALID_ID_EDGES,
    NONEXISTENT_ID,
  });

  if (!existsSync(GUIDE_PATH)) {
    return [{ file: GUIDE_PATH, status: 'missing' }];
  }
  const actual = readFileSync(GUIDE_PATH, 'utf-8');
  if (actual !== expected) {
    return [{ file: GUIDE_PATH, status: 'mismatch' }];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const CHECK_MODE = process.argv.includes('--check');
  const filesArg = parseFilesArg(process.argv);

  // Differential mode: if --files was supplied but SSOT is not among changed files,
  // the guide cannot have drifted — skip the check entirely.
  if (filesArg !== null && !isSsotChanged(filesArg)) {
    console.log(
      `gen-boundary-guide: SSOT (${SSOT_RELATIVE}) not in changed files — skipping check.`,
    );
    process.exit(0);
  }

  if (CHECK_MODE) {
    const drifts = checkDrift();
    if (drifts.length === 0) {
      console.log('gen-boundary-guide: no drift detected.');
      process.exit(0);
    } else {
      for (const d of drifts) {
        console.error(`DRIFT [${d.status}]: ${d.file}`);
      }
      console.error(`\nRun \`bun run gen:boundary-guide\` to regenerate and commit the file.`);
      process.exit(1);
    }
  } else {
    // Generate mode
    const content = generateGuideContent({
      STRING_EDGES,
      ID_EDGES,
      NUMERIC_ID_BOUNDARIES,
      BOUNDARY_STRINGS,
      TIME_BOUNDARIES,
      NULLABLE_ID_EDGES,
      INVALID_ID_EDGES,
      NONEXISTENT_ID,
    });
    const dir = dirname(GUIDE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(GUIDE_PATH, content, 'utf-8');
    console.log(`Generated: ${GUIDE_PATH}`);
    console.log('\nDone. Commit the generated file to keep the repository in sync.');
  }
}
