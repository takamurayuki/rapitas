/**
 * gen-boundary-guide
 *
 * `tests/helpers/boundary-values.ts` の `BOUNDARY_CONTEXT_MAP` を読み込み、
 * テスト作成者向けガイド `docs/test-boundary-values-guide.md` を生成する。
 *
 * drift 検知機能により、コミット済みガイドとメタデータが常に同期していることを保証する。
 * メタデータ変更後は必ず本スクリプトを再実行してガイドを再生成・コミットすること。
 *
 * Usage:
 *   bun run gen:boundary-guide              # ガイドを生成・上書き
 *   bun run gen:boundary-guide --check      # drift を検知 → 不一致なら exit 1
 *   bun run gen:boundary-guide --warn-only  # drift を検知 → exit 0 で警告のみ
 *   bun run gen:boundary-guide --check --files=a.ts,b.ts  # 差分ファイルのみチェック（--files は無視される: 本スクリプトはソース固定）
 *
 * NOTE: 生成物 docs/test-boundary-values-guide.md は手動編集禁止。
 *       変更が必要な場合は BOUNDARY_CONTEXT_MAP を編集してから本スクリプトを再実行すること。
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  BOUNDARY_CONTEXT_MAP,
  type BoundaryConstMeta,
} from '../tests/helpers/boundary-values';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** 生成されるガイドの出力先パス。 */
const GUIDE_OUTPUT_PATH = join(ROOT, 'docs', 'test-boundary-values-guide.md');

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

/** drift チェック結果の 1 エントリ。 */
export interface DriftResult {
  /** チェック対象ファイルの絶対パス */
  file: string;
  /** 'missing': ファイルが存在しない / 'mismatch': 内容が期待値と異なる */
  status: 'missing' | 'mismatch';
}

// ---------------------------------------------------------------------------
// CLI 引数パーサー（gen-type-guards.ts と同一インターフェース）
// ---------------------------------------------------------------------------

/**
 * `--files` CLI 引数をパースする。
 *
 * NOTE: 本スクリプトはソースが BOUNDARY_CONTEXT_MAP の import 固定であるため
 * `--files` の値は drift チェックのスコープ限定に使用されない。
 * gen-type-guards.ts / gen-resolver-boundary-tests.ts との I/F 統一のために実装している。
 *
 * @param argv - process.argv / コマンドライン引数配列
 * @returns パース済みファイルパス、または null（--files 指定なし）
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

// ---------------------------------------------------------------------------
// Markdown 生成
// ---------------------------------------------------------------------------

/**
 * 入力型のラベル（表ヘッダー用）を返す。
 *
 * @param inputType - BoundaryInputType / 入力型文字列
 * @returns 表示用ラベル
 */
function inputTypeLabel(inputType: string): string {
  if (inputType === 'string') return '文字列 (`string`)';
  if (inputType === 'number') return '数値 (`number`)';
  if (inputType === 'number | null') return '数値またはnull (`number \\| null`)';
  return inputType;
}

/**
 * `BOUNDARY_CONTEXT_MAP` を受け取り、決定的な Markdown ガイド文字列を生成する。
 *
 * - キーを定数名でソートして出力順を固定し、drift 検知を安定させる。
 * - 時刻・乱数を含めないため、同一メタデータからは常に同一出力が得られる。
 *
 * @param map - メタデータマップ（`BOUNDARY_CONTEXT_MAP` を渡す）
 * @returns 生成された Markdown 文字列
 */
export function generateGuideMarkdown(map: Readonly<Record<string, BoundaryConstMeta>>): string {
  const entries = Object.keys(map)
    .sort()
    .map((k) => map[k]);

  const lines: string[] = [];

  // ヘッダー
  lines.push('<!-- このファイルは自動生成されます。手動編集禁止。-->');
  lines.push('<!-- 再生成: `bun run gen:boundary-guide` (ソース: scripts/gen-boundary-guide.ts) -->');
  lines.push('');
  lines.push('# テスト境界値定数 選択ガイド');
  lines.push('');
  lines.push(
    '`tests/helpers/boundary-values.ts` が提供する境界値定数の一覧と選択基準。',
  );
  lines.push(
    '新しいテストファイルを作成する際は、このガイドを参照して適切な定数セットを選択すること。',
  );
  lines.push('');

  // 選択フロー
  lines.push('## 選択フロー');
  lines.push('');
  lines.push('```');
  lines.push('引数の型は何か？');
  lines.push('├── string');
  lines.push('│   ├── 改行（\\n）が有効な入力フィールドか？');
  lines.push('│   │   ├── YES → BOUNDARY_STRINGS');
  lines.push('│   │   └── NO  → STRING_EDGES（推奨デフォルト）');
  lines.push('├── number');
  lines.push('│   ├── Number.MAX_SAFE_INTEGER での堅牢性を検証したいか？');
  lines.push('│   │   ├── YES → NUMERIC_ID_BOUNDARIES');
  lines.push('│   │   └── NO  → ID_EDGES（推奨デフォルト）');
  lines.push('│   └── 将来の時刻引数（現状は resolver に時刻引数なし）');
  lines.push('│       └── TIME_BOUNDARIES（reserved — 現状未使用）');
  lines.push('└── number | null');
  lines.push('    └── NULLABLE_ID_EDGES（外部キー等の nullable ID 引数）');
  lines.push('```');
  lines.push('');

  // 定数一覧表（入力型別グルーピング）
  lines.push('## 定数一覧');
  lines.push('');

  const byInputType = new Map<string, BoundaryConstMeta[]>();
  for (const entry of entries) {
    const key = entry.inputType;
    if (!byInputType.has(key)) byInputType.set(key, []);
    byInputType.get(key)!.push(entry);
  }

  // 入力型をソート（string → number → number | null の順）
  const typeOrder = ['string', 'number', 'number | null'];
  const sortedTypes = [...byInputType.keys()].sort(
    (a, b) => typeOrder.indexOf(a) - typeOrder.indexOf(b),
  );

  for (const inputType of sortedTypes) {
    const group = byInputType.get(inputType)!;
    lines.push(`### ${inputTypeLabel(inputType)}`);
    lines.push('');
    lines.push('| 定数名 | 改行含む | 大値含む | 自動生成 | 状態 | 用途 |');
    lines.push('|--------|----------|----------|----------|------|------|');
    for (const e of group) {
      const newline = e.includesNewline ? '✅' : '—';
      const large = e.includesLargeValue ? '✅' : '—';
      const gen = e.genUsed ? '✅' : '—';
      const status = e.status === 'reserved' ? '⚠️ reserved' : 'active';
      // NOTE: Escape `|` in useFor to prevent table column misparse (e.g. "number | null").
      const useForEscaped = e.useFor.replace(/\|/g, '\\|');
      lines.push(`| \`${e.constName}\` | ${newline} | ${large} | ${gen} | ${status} | ${useForEscaped} |`);
    }
    lines.push('');
  }

  // STRING_EDGES vs BOUNDARY_STRINGS の使い分け説明
  lines.push('## `STRING_EDGES` vs `BOUNDARY_STRINGS` の使い分け');
  lines.push('');
  lines.push(
    '両者はともに `string` 型引数向けの境界値定数だが、**改行文字（`\\n`）を含むかどうか**で使い分ける。',
  );
  lines.push('');
  lines.push('| 定数名 | `\\n` を含む | 対象フィールドの例 |');
  lines.push('|--------|------------|-------------------|');
  lines.push('| `STRING_EDGES` | ❌（改行なし） | email, token, username, slug |');
  lines.push('| `BOUNDARY_STRINGS` | ✅（改行あり） | メモ, 本文, 複数行テキスト |');
  lines.push('');
  lines.push(
    '> **原則**: 判断に迷ったら `STRING_EDGES` を使う。改行が入力として意味を持つフィールドのみ `BOUNDARY_STRINGS` を選ぶ。',
  );
  lines.push('');

  // 自動生成に関する注記
  lines.push('## `gen:boundary-tests` での自動選択');
  lines.push('');
  lines.push(
    '`bun run gen:boundary-tests` は `*-resolver.ts` を解析し、引数型に応じて以下の定数を自動選択する。',
  );
  lines.push('');
  lines.push('| 引数型 | 自動選択される定数 |');
  lines.push('|--------|-------------------|');

  const genEntries = entries.filter((e) => e.genUsed);
  for (const e of genEntries) {
    // NOTE: Escape `|` in inputType to prevent table column misparse (e.g. "number | null").
    const inputTypeEscaped = e.inputType.replace(/\|/g, '\\|');
    lines.push(`| \`${inputTypeEscaped}\` | \`${e.constName}\` |`);
  }

  lines.push('');
  lines.push(
    '手動テストで別の定数（`NUMERIC_ID_BOUNDARIES` 等）が必要な場合は、`.boundary.test.ts` ではなく通常のテストファイルに追記する。',
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// drift チェック
// ---------------------------------------------------------------------------

/**
 * 生成期待値とコミット済み `docs/test-boundary-values-guide.md` を比較する。
 *
 * @param outputPath - チェック対象のガイドファイルパス（デフォルト: GUIDE_OUTPUT_PATH）
 * @returns drift が存在する場合は DriftResult の配列、なければ空配列
 */
export function checkDrift(outputPath: string = GUIDE_OUTPUT_PATH): DriftResult[] {
  const expected = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);

  if (!existsSync(outputPath)) {
    return [{ file: outputPath, status: 'missing' }];
  }

  const actual = readFileSync(outputPath, 'utf-8');
  if (actual !== expected) {
    return [{ file: outputPath, status: 'mismatch' }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const CHECK_MODE = process.argv.includes('--check');
  const WARN_ONLY = process.argv.includes('--warn-only');

  if (CHECK_MODE || WARN_ONLY) {
    const drifts = checkDrift();
    if (drifts.length === 0) {
      console.log('gen-boundary-guide: no drift detected.');
      process.exit(0);
    } else {
      for (const d of drifts) {
        console.error(`DRIFT [${d.status}]: ${d.file}`);
      }
      console.error(
        `\nRun \`bun run gen:boundary-guide\` to regenerate and commit the updated file.`,
      );
      process.exit(WARN_ONLY ? 0 : 1);
    }
  } else {
    // 生成モード
    const content = generateGuideMarkdown(BOUNDARY_CONTEXT_MAP);
    writeFileSync(GUIDE_OUTPUT_PATH, content, 'utf-8');
    console.log(`Generated: ${GUIDE_OUTPUT_PATH}`);
    console.log(
      '\nDone — commit docs/test-boundary-values-guide.md to keep the repository in sync.',
    );
  }
}
