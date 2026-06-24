/**
 * gen-boundary-guide
 *
 * Reads tests/helpers/boundary-values.ts (SSOT) and generates
 * docs/boundary-guide.generated.md — a human-readable reference guide
 * for all boundary value constants used in resolver tests.
 * Section descriptions are extracted from the JSDoc comments in the SSOT file,
 * making boundary-values.ts the single source of truth for both values and documentation.
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
  DATE_EDGES,
  ENUM_INVALID_EDGES,
  FLOAT_EDGES,
  PG_INT_BOUNDARIES,
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
  DATE_EDGES: readonly BoundaryCaseEntry[];
  ENUM_INVALID_EDGES: readonly BoundaryCaseEntry[];
  FLOAT_EDGES: readonly BoundaryCaseEntry[];
  PG_INT_BOUNDARIES: readonly BoundaryCaseEntry[];
}

/** Represents a file that is out of sync with the generated output. */
export interface DriftResult {
  file: string;
  status: 'missing' | 'mismatch';
}

/** Section descriptions for the generated guide, one entry per exported constant. */
export interface SectionDescriptions {
  STRING_EDGES: string;
  ID_EDGES: string;
  NUMERIC_ID_BOUNDARIES: string;
  BOUNDARY_STRINGS: string;
  TIME_BOUNDARIES: string;
  NULLABLE_ID_EDGES: string;
  INVALID_ID_EDGES: string;
  NONEXISTENT_ID: string;
}

/**
 * Hardcoded fallback descriptions — mirror the first JSDoc sentence of each export in
 * boundary-values.ts. Used when the SSOT file is unavailable or extraction fails.
 */
export const DEFAULT_DESCRIPTIONS: SectionDescriptions = {
  STRING_EDGES: '文字列引数 resolver 向けの境界値定数。',
  ID_EDGES: '数値 ID 引数 resolver 向けの境界値定数（0/-1/1 の小規模セット）。',
  NUMERIC_ID_BOUNDARIES:
    '数値型 ID の境界値セット（ID_EDGES の拡張版 — MAX_SAFE_INTEGER を含む）。',
  BOUNDARY_STRINGS: '文字列型フィールドの境界値セット（改行を含む）。',
  TIME_BOUNDARIES: '時刻（epoch ミリ秒）の境界値セット。',
  NULLABLE_ID_EDGES: 'nullable 数値 ID 引数 resolver 向けの境界値定数。',
  INVALID_ID_EDGES: 'バリデーションで拒否されるべき非正 ID の境界値セット。',
  NONEXISTENT_ID: 'DB に存在しないことを表すセンチネル ID。',
};

/**
 * Extracts the first description line from the JSDoc comment preceding a named export.
 * Uses regex to find the JSDoc block; returns the fallback when no match is found.
 *
 * @param source - TypeScript source code to search / 検索対象のソースコード
 * @param exportName - Name of the exported constant / エクスポート定数名
 * @param fallback - Used when extraction fails / 抽出失敗時のフォールバック
 * @returns First non-empty, non-tag line of the JSDoc description
 */
export function extractJsDocDescription(
  source: string,
  exportName: string,
  fallback: string,
): string {
  // NOTE: (?:[^*]|\*(?!\/))*  prevents the pattern from crossing a */ boundary,
  // so each match is scoped to a single JSDoc block.
  const pattern = new RegExp(
    `/\\*\\*((?:[^*]|\\*(?!\\/))*)\\*/\\s*export\\s+(?:const|type|function)\\s+${exportName}\\b`,
  );
  const match = source.match(pattern);
  if (!match) return fallback;

  const firstLine = match[1]
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))[0];

  return firstLine ?? fallback;
}

/**
 * Reads section descriptions from the JSDoc comments in boundary-values.ts source.
 * Falls back to DEFAULT_DESCRIPTIONS for each constant when extraction fails.
 *
 * @param source - Source code of boundary-values.ts / boundary-values.ts の内容
 * @returns Section descriptions keyed by constant name
 */
export function loadSsotDescriptions(source: string): SectionDescriptions {
  const extract = (name: string, fallback: string) =>
    extractJsDocDescription(source, name, fallback);
  return {
    STRING_EDGES: extract('STRING_EDGES', DEFAULT_DESCRIPTIONS.STRING_EDGES),
    ID_EDGES: extract('ID_EDGES', DEFAULT_DESCRIPTIONS.ID_EDGES),
    NUMERIC_ID_BOUNDARIES: extract(
      'NUMERIC_ID_BOUNDARIES',
      DEFAULT_DESCRIPTIONS.NUMERIC_ID_BOUNDARIES,
    ),
    BOUNDARY_STRINGS: extract('BOUNDARY_STRINGS', DEFAULT_DESCRIPTIONS.BOUNDARY_STRINGS),
    TIME_BOUNDARIES: extract('TIME_BOUNDARIES', DEFAULT_DESCRIPTIONS.TIME_BOUNDARIES),
    NULLABLE_ID_EDGES: extract('NULLABLE_ID_EDGES', DEFAULT_DESCRIPTIONS.NULLABLE_ID_EDGES),
    INVALID_ID_EDGES: extract('INVALID_ID_EDGES', DEFAULT_DESCRIPTIONS.INVALID_ID_EDGES),
    NONEXISTENT_ID: extract('NONEXISTENT_ID', DEFAULT_DESCRIPTIONS.NONEXISTENT_ID),
  };
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
  // NOTE: \r must be escaped before \n to avoid double-escaping \r\n sequences.
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n');
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
 * Section descriptions are taken from `descriptions` (JSDoc-extracted or fallback).
 *
 * @param input - Boundary value constants from boundary-values.ts / 境界値定数
 * @param descriptions - Section descriptions; defaults to DEFAULT_DESCRIPTIONS / セクション説明
 * @returns Markdown string for docs/boundary-guide.generated.md
 */
export function generateGuideContent(
  input: BoundaryGuideInput,
  descriptions: SectionDescriptions = DEFAULT_DESCRIPTIONS,
): string {
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
    `${descriptions.STRING_EDGES}\n` +
    `\n` +
    renderTable(input.STRING_EDGES) +
    `\n\n` +
    `### \`ID_EDGES\`\n` +
    `\n` +
    `${descriptions.ID_EDGES}\n` +
    `\n` +
    renderTable(input.ID_EDGES) +
    `\n\n` +
    `### \`NUMERIC_ID_BOUNDARIES\`\n` +
    `\n` +
    `${descriptions.NUMERIC_ID_BOUNDARIES}\n` +
    `\n` +
    renderTable(input.NUMERIC_ID_BOUNDARIES) +
    `\n\n` +
    `### \`BOUNDARY_STRINGS\`\n` +
    `\n` +
    `${descriptions.BOUNDARY_STRINGS}\n` +
    `\n` +
    renderTable(input.BOUNDARY_STRINGS) +
    `\n\n` +
    `### \`TIME_BOUNDARIES\`\n` +
    `\n` +
    `${descriptions.TIME_BOUNDARIES}\n` +
    `\n` +
    renderTable(input.TIME_BOUNDARIES) +
    `\n\n` +
    `### \`NULLABLE_ID_EDGES\`\n` +
    `\n` +
    `${descriptions.NULLABLE_ID_EDGES}\n` +
    `\n` +
    renderTable(input.NULLABLE_ID_EDGES) +
    `\n\n` +
    `### \`INVALID_ID_EDGES\`\n` +
    `\n` +
    `${descriptions.INVALID_ID_EDGES}\n` +
    `\n` +
    renderTable(input.INVALID_ID_EDGES) +
    `\n\n` +
    `### \`NONEXISTENT_ID\`\n` +
    `\n` +
    `${descriptions.NONEXISTENT_ID}\n` +
    `\n` +
    `| 値 |\n` +
    `| --- |\n` +
    `| \`${input.NONEXISTENT_ID}\` |\n` +
    `\n` +
    `### \`DATE_EDGES\`\n` +
    `\n` +
    `日付文字列の境界値セット（ISO 8601 形式）。将来的に日付文字列引数を取る resolver 向け。\n` +
    `ISO 8601 文字列で保持し、テスト側で \`new Date(value)\` に変換して使用する。\n` +
    `\n` +
    renderTable(input.DATE_EDGES) +
    `\n\n` +
    `### \`ENUM_INVALID_EDGES\`\n` +
    `\n` +
    `Enum 型引数に対する無効値の境界値セット。\`makeEnumBoundaries()\` の \`invalid\` 省略時のデフォルト値として使用する。\n` +
    `\n` +
    renderTable(input.ENUM_INVALID_EDGES) +
    `\n\n` +
    `### \`FLOAT_EDGES\`\n` +
    `\n` +
    `浮動小数点数の境界値セット（NaN / Infinity / EPSILON を含む）。将来的に浮動小数点引数を取る関数向けに定義のみ用意。\n` +
    `\n` +
    renderTable(input.FLOAT_EDGES) +
    `\n\n` +
    `### \`PG_INT_BOUNDARIES\`\n` +
    `\n` +
    `PostgreSQL INTEGER (INT4) 型の境界値セット（-2147483648 〜 2147483647）。\`NUMERIC_ID_BOUNDARIES\`（MAX_SAFE_INTEGER）との差別化設計。\n` +
    `\n` +
    renderTable(input.PG_INT_BOUNDARIES) +
    `\n\n` +
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
 * Loads JSDoc descriptions from the SSOT file to match what the generator produces.
 *
 * @returns Array of DriftResult for each out-of-sync file (empty = no drift)
 */
export function checkDrift(): DriftResult[] {
  const ssotPath = join(ROOT, SSOT_RELATIVE);
  const descriptions = existsSync(ssotPath)
    ? loadSsotDescriptions(readFileSync(ssotPath, 'utf-8'))
    : DEFAULT_DESCRIPTIONS;

  const expected = generateGuideContent(
    {
      STRING_EDGES,
      ID_EDGES,
      NUMERIC_ID_BOUNDARIES,
      BOUNDARY_STRINGS,
      TIME_BOUNDARIES,
      NULLABLE_ID_EDGES,
      INVALID_ID_EDGES,
      NONEXISTENT_ID,
      DATE_EDGES,
      ENUM_INVALID_EDGES,
      FLOAT_EDGES,
      PG_INT_BOUNDARIES,
    },
    descriptions,
  );

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

  const ssotSource = readFileSync(join(ROOT, SSOT_RELATIVE), 'utf-8');
  const descriptions = loadSsotDescriptions(ssotSource);

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
    const content = generateGuideContent(
      {
        STRING_EDGES,
        ID_EDGES,
        NUMERIC_ID_BOUNDARIES,
        BOUNDARY_STRINGS,
        TIME_BOUNDARIES,
        NULLABLE_ID_EDGES,
        INVALID_ID_EDGES,
        NONEXISTENT_ID,
        DATE_EDGES,
        ENUM_INVALID_EDGES,
        FLOAT_EDGES,
        PG_INT_BOUNDARIES,
      },
      descriptions,
    );
    const dir = dirname(GUIDE_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(GUIDE_PATH, content, 'utf-8');
    console.log(`Generated: ${GUIDE_PATH}`);
    console.log('\nDone. Commit the generated file to keep the repository in sync.');
  }
}
