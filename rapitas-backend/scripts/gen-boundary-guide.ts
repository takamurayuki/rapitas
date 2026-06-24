/**
 * gen-boundary-guide
 *
 * tests/helpers/boundary-values.ts (SSOT) を読み込み、境界値テスト開発者ガイドを生成する。
 * 生成先: docs/boundary-values-guide.md
 *
 * Usage:
 *   bun run gen:boundary-guide                         # ガイドを再生成
 *   bun run gen:boundary-guide --check                 # ドリフトを検知 (exit 1)
 *   bun run gen:boundary-guide --check --files <...>  # 変更ファイルによるゲートチェック
 *
 * NOTE: --files は「チェックを実行すべきか」のゲート判定専用。
 *       gen-resolver-boundary-tests の「走査対象指定」とは意味が異なる。
 *       SSOT は tests/helpers/boundary-values.ts の単一固定ファイル。
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPTS_DIR, '..');

/** SSOT: 境界値定数の唯一の情報源 */
export const SSOT_PATH = join(ROOT, 'tests', 'helpers', 'boundary-values.ts');
/** 生成出力先: 境界値テスト開発者ガイド */
export const GUIDE_PATH = join(ROOT, 'docs', 'boundary-values-guide.md');

// ---------------------------------------------------------------------------
// JSDoc 静的パース
// ---------------------------------------------------------------------------

/**
 * ソースファイルの `export const/type/function <constName>` 直前の JSDoc を抽出する。
 * 先頭の説明段落のみ返す — `@example` / `@param` / `@typeParam` 行以降は除外する。
 *
 * @param source - ソースファイルの全文 / Full text of the source file
 * @param constName - 対象の export 名 / Name of the exported symbol
 * @returns 説明文（見つからなければ '' を返し console.warn を出す）
 */
export function extractJsDoc(source: string, constName: string): string {
  // NOTE: (?:[^*]|\*(?!\/))*  で「`*/` を含まない単一コメントブロック」だけにマッチさせる。
  //       [\s\S]*? (非貪欲) を使うと前の /** から次の */ までを跨いで誤抽出する。
  const pattern = new RegExp(
    `\\/\\*\\*((?:[^*]|\\*(?!\\/))*)\\*\\/\\s*export\\s+(?:type\\s+|const\\s+|function\\s+)${constName}\\b`,
  );
  const match = source.match(pattern);
  if (!match) {
    console.warn(`[gen-boundary-guide] JSDoc not found for: ${constName}`);
    return '';
  }

  const lines = match[1].split('\n').map((line) => line.replace(/^\s*\*\s?/, ''));

  const descLines: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('@')) break;
    descLines.push(line);
  }

  return descLines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// テーブル生成
// ---------------------------------------------------------------------------

/**
 * `BoundaryCase<T>[]` を Markdown テーブルに変換する。
 * 値は `JSON.stringify` で表示し、空文字・制御文字を可読かつ決定論的に出力する。
 *
 * @param cases - 境界値ケース配列 / Array of boundary cases
 * @returns Markdown テーブル文字列
 */
export function renderCasesTable(
  cases: ReadonlyArray<{ label: string; value: unknown; note?: string }>,
): string {
  const header = '| label | value | note |\n| --- | --- | --- |';
  const rows = cases
    .map(({ label, value, note }) => {
      const valueStr = JSON.stringify(value);
      const noteStr = note ?? '';
      return `| ${label} | \`${valueStr}\` | ${noteStr} |`;
    })
    .join('\n');
  return `${header}\n${rows}`;
}

// ---------------------------------------------------------------------------
// ガイド生成
// ---------------------------------------------------------------------------

/** 配列定数のメタ情報（生成順序を固定するため明示宣言） */
const ARRAY_CONST_NAMES = [
  'STRING_EDGES',
  'ID_EDGES',
  'NUMERIC_ID_BOUNDARIES',
  'BOUNDARY_STRINGS',
  'TIME_BOUNDARIES',
  'NULLABLE_ID_EDGES',
  'INVALID_ID_EDGES',
] as const;

type ArrayConstName = (typeof ARRAY_CONST_NAMES)[number];

type BoundaryCase<T> = { label: string; value: T; note?: string };

type BoundaryModule = {
  [K in ArrayConstName]: ReadonlyArray<BoundaryCase<unknown>>;
} & {
  NONEXISTENT_ID: number;
};

/**
 * SSOT から境界値テストガイドの Markdown 文字列を生成する。
 * 値は動的 import で取得し、JSDoc 説明文は readFileSync の正規表現パースで取得する。
 *
 * @returns 生成された Markdown 文字列
 */
export async function generateGuideContent(): Promise<string> {
  const bv = (await import('../tests/helpers/boundary-values')) as BoundaryModule;
  const source = readFileSync(SSOT_PATH, 'utf-8');

  // ヘッダー
  const header =
    `# 境界値テストガイド\n\n` +
    `> 自動生成ファイル — 手動編集不可。再生成: \`bun run gen:boundary-guide\`  \n` +
    `> ソース: \`tests/helpers/boundary-values.ts\`\n\n`;

  // 型定義節
  const bcJsDoc = extractJsDoc(source, 'BoundaryCase');
  const typeSection =
    `## 型定義\n\n` +
    `### \`BoundaryCase<T>\`\n\n` +
    (bcJsDoc ? `${bcJsDoc}\n\n` : '') +
    `\`\`\`ts\n` +
    `type BoundaryCase<T> = {\n` +
    `  readonly label: string;   // テスト名に表示される人間可読な識別子\n` +
    `  readonly value: T;        // 境界値本体（resolver に渡す実値）\n` +
    `  readonly note?: string;   // 暗黙前提や制約などの補足（省略可）\n` +
    `};\n` +
    `\`\`\`\n\n`;

  // 配列定数節
  const arraySubSections = ARRAY_CONST_NAMES.map((name) => {
    const cases = bv[name];
    const jsdoc = extractJsDoc(source, name);
    const table = renderCasesTable(cases);
    return `### \`${name}\`\n\n${jsdoc ? `${jsdoc}\n\n` : ''}${table}\n`;
  }).join('\n');

  const constantsSection = `## 配列定数\n\n${arraySubSections}\n`;

  // スカラー定数節
  const scalarJsDoc = extractJsDoc(source, 'NONEXISTENT_ID');
  const scalarSection =
    `## スカラー定数\n\n` +
    (scalarJsDoc ? `${scalarJsDoc}\n\n` : '') +
    `| 定数名 | 値 |\n` +
    `| --- | --- |\n` +
    `| \`NONEXISTENT_ID\` | \`${JSON.stringify(bv.NONEXISTENT_ID)}\` |\n\n`;

  // ユーティリティ節
  const utilJsDoc = extractJsDoc(source, 'toNameTuples');
  const utilSection =
    `## ユーティリティ\n\n` +
    `### \`toNameTuples<T>(cases)\`\n\n` +
    (utilJsDoc ? `${utilJsDoc}\n` : '');

  return header + typeSection + constantsSection + scalarSection + utilSection;
}

// ---------------------------------------------------------------------------
// --files ゲート判定
// ---------------------------------------------------------------------------

/**
 * `--files` CLI 引数をパースする（gen-resolver-boundary-tests と同一シグネチャ）。
 *
 * @param argv - process.argv / コマンドライン引数
 * @returns `--files` が存在すればファイルパス配列、なければ null
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
 * 変更ファイル一覧にガイドのドリフト原因となるファイルが含まれるか判定する。
 *
 * NOTE: この関数は「チェックを実行すべきか」のゲート判定専用。
 *       gen-resolver-boundary-tests の --files（走査対象選択）とは意味が異なる。
 *       SSOT は単一固定ファイルのため、判定対象は2ファイルのみ。
 *
 * @param files - 変更ファイルパスの一覧（相対/絶対パス両対応）
 * @returns ドリフトチェックを実行すべきなら true
 */
export function isRelevantChange(files: string[]): boolean {
  if (files.length === 0) return false;
  return files.some(
    (f) => f.endsWith('boundary-values.ts') || f.endsWith('boundary-values-guide.md'),
  );
}

// ---------------------------------------------------------------------------
// ドリフト検知
// ---------------------------------------------------------------------------

/** 生成成果物がディスク上のファイルとズレている場合の情報 */
export interface DriftResult {
  /** ファイルの絶対パス */
  file: string;
  /** 'missing': ファイル不在 / 'mismatch': 内容不一致 */
  status: 'missing' | 'mismatch';
}

/**
 * 生成成果物 (`docs/boundary-values-guide.md`) をディスク上のファイルと比較する。
 * テスト用に targetPath を上書き可能にしている（実ファイルを破壊しないため）。
 *
 * @param targetPath - 比較対象ファイルのパス（デフォルト: GUIDE_PATH）
 * @returns ドリフト結果の配列（空 = ドリフトなし）
 */
export async function checkDrift(targetPath = GUIDE_PATH): Promise<DriftResult[]> {
  // NOTE: Check existence first — avoids calling generateGuideContent() unnecessarily and
  //       eliminates the TOCTOU window between existsSync and readFileSync.
  if (!existsSync(targetPath)) {
    return [{ file: targetPath, status: 'missing' }];
  }

  const expected = await generateGuideContent();
  const actual = readFileSync(targetPath, 'utf-8');
  if (actual !== expected) {
    return [{ file: targetPath, status: 'mismatch' }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// メインエントリポイント
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const CHECK_MODE = process.argv.includes('--check');
  const filesArg = parseFilesArg(process.argv);

  if (CHECK_MODE && filesArg !== null && !isRelevantChange(filesArg)) {
    console.log('gen-boundary-guide: no relevant changes detected, skipping drift check.');
    process.exit(0);
  }

  if (CHECK_MODE) {
    const drifts = await checkDrift();
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
      process.exit(1);
    }
  } else {
    const content = await generateGuideContent();
    writeFileSync(GUIDE_PATH, content, 'utf-8');
    console.log(`Generated: ${GUIDE_PATH}`);
    console.log('\nDone. Commit the generated file to keep the repository in sync.');
  }
}
