/**
 * gen-shutdown-error-artifacts
 *
 * Reads the shutdown-error SSOT and generates three artifacts:
 *   1. `utils/common/shutdown-error.generated.test.ts` — deterministic truth-table test
 *   2. `docs/shutdown-error-spec.md` — HTTP status code specification (deterministic)
 *   3. `docs/shutdown-error-changelog.md` — append-only changelog (non-deterministic)
 *
 * Usage:
 *   bun run gen:shutdown-error            # regenerate all artifacts
 *   bun run gen:shutdown-error --check    # exit 1 if test/spec drift detected
 *
 * NOTE: The changelog is excluded from --check because it contains timestamps.
 * Only the deterministic artifacts (test + spec) are compared for drift.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';

import {
  SHUTDOWN_ACTIONS,
  SHUTDOWN_ERROR_MESSAGE,
  WORKER_SHUTDOWN_ERROR_MESSAGE,
} from '../utils/common/shutdown-error';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Path to the generated test file (deterministic, included in drift check). */
export const GENERATED_TEST_PATH = join(
  ROOT,
  'utils',
  'common',
  'shutdown-error.generated.test.ts',
);
/** Path to the spec doc (deterministic, included in drift check). */
export const SPEC_PATH = join(ROOT, 'docs', 'shutdown-error-spec.md');
/** Path to the changelog (non-deterministic / timestamps, excluded from drift check). */
export const CHANGELOG_PATH = join(ROOT, 'docs', 'shutdown-error-changelog.md');

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

/**
 * Generates the deterministic truth-table test file content.
 * Inlines all SSOT values so that any change to SHUTDOWN_ACTIONS,
 * SHUTDOWN_ERROR_MESSAGE, or WORKER_SHUTDOWN_ERROR_MESSAGE changes this output.
 *
 * @returns Source code string for `shutdown-error.generated.test.ts`
 */
export function generateTestFileContent(): string {
  const actionCases = [...SHUTDOWN_ACTIONS]
    .map(
      (action) =>
        `  test('action: "${action}" — buildShutdownErrorMessage + isShutdownError', () => {\n` +
        `    expect(buildShutdownErrorMessage('${action}')).toBe(\n` +
        `      '${SHUTDOWN_ERROR_MESSAGE}, cannot ${action}',\n` +
        `    );\n` +
        `    expect(isShutdownError(new Error(buildShutdownErrorMessage('${action}')))).toBe(true);\n` +
        `  });`,
    )
    .join('\n\n');

  return (
    `/**\n` +
    ` * shutdown-error.generated.test\n` +
    ` *\n` +
    ` * 自動生成ファイル — 手動編集不可。再生成: \`bun run gen:shutdown-error\`\n` +
    ` * ソース: scripts/gen-shutdown-error-artifacts.ts\n` +
    ` *\n` +
    ` * SNAPSHOT:\n` +
    ` *   SHUTDOWN_ACTIONS: ${JSON.stringify([...SHUTDOWN_ACTIONS])}\n` +
    ` *   SHUTDOWN_ERROR_MESSAGE: "${SHUTDOWN_ERROR_MESSAGE}"\n` +
    ` *   WORKER_SHUTDOWN_ERROR_MESSAGE: "${WORKER_SHUTDOWN_ERROR_MESSAGE}"\n` +
    ` */\n` +
    `import { describe, expect, test } from 'bun:test';\n` +
    `import { buildShutdownErrorMessage, isShutdownError } from './shutdown-error';\n` +
    `\n` +
    `describe('SHUTDOWN_ACTIONS ラウンドトリップ（自動生成）', () => {\n` +
    actionCases +
    `\n});\n` +
    `\n` +
    `describe('isShutdownError 真理値表（自動生成）', () => {\n` +
    `  test('Worker 完全一致 → true', () => {\n` +
    `    expect(isShutdownError(new Error('${WORKER_SHUTDOWN_ERROR_MESSAGE}'))).toBe(true);\n` +
    `  });\n` +
    `\n` +
    `  test('Server プレフィックスのみ → true', () => {\n` +
    `    expect(isShutdownError(new Error('${SHUTDOWN_ERROR_MESSAGE}'))).toBe(true);\n` +
    `  });\n` +
    `\n` +
    `  test('Worker + suffix → false（完全一致のみ）', () => {\n` +
    `    expect(isShutdownError(new Error('${WORKER_SHUTDOWN_ERROR_MESSAGE} — extra text'))).toBe(false);\n` +
    `  });\n` +
    `\n` +
    `  test('null → false', () => {\n` +
    `    expect(isShutdownError(null)).toBe(false);\n` +
    `  });\n` +
    `\n` +
    `  test('string → false（instanceof Error ✕）', () => {\n` +
    `    expect(isShutdownError('${SHUTDOWN_ERROR_MESSAGE}')).toBe(false);\n` +
    `  });\n` +
    `\n` +
    `  test('プレーンオブジェクト → false（instanceof Error ✕）', () => {\n` +
    `    expect(isShutdownError({ message: '${SHUTDOWN_ERROR_MESSAGE}' })).toBe(false);\n` +
    `  });\n` +
    `});\n`
  );
}

/**
 * Generates the deterministic specification document content.
 *
 * @returns Markdown string for `docs/shutdown-error-spec.md`
 */
export function generateSpecContent(): string {
  const actionsTable = [...SHUTDOWN_ACTIONS]
    .map((action) => `| \`${action}\` | \`${SHUTDOWN_ERROR_MESSAGE}, cannot ${action}\` |`)
    .join('\n');

  const allActionsRows = [...SHUTDOWN_ACTIONS]
    .map(
      (action) =>
        `| \`Error('${SHUTDOWN_ERROR_MESSAGE}, cannot ${action}')\` | \`true\` | \`${SHUTDOWN_ERROR_MESSAGE}\` 前方一致 |`,
    )
    .join('\n');

  return (
    `# shutdown-error 仕様書\n` +
    `\n` +
    `> 自動生成ファイル — \`bun run gen:shutdown-error\` で再生成。手動編集不可。  \n` +
    `> ソース: \`scripts/gen-shutdown-error-artifacts.ts\`\n` +
    `\n` +
    `## 定数\n` +
    `\n` +
    `| 定数 | 値 | レイヤー |\n` +
    `| --- | --- | --- |\n` +
    `| \`SHUTDOWN_ERROR_MESSAGE\` | \`'${SHUTDOWN_ERROR_MESSAGE}'\` | Orchestrator 系プレフィックス |\n` +
    `| \`WORKER_SHUTDOWN_ERROR_MESSAGE\` | \`'${WORKER_SHUTDOWN_ERROR_MESSAGE}'\` | Agent-Worker IPC 完全一致 |\n` +
    `\n` +
    `## アクション一覧 (SHUTDOWN_ACTIONS)\n` +
    `\n` +
    `| アクション | 生成されるエラーメッセージ |\n` +
    `| --- | --- |\n` +
    actionsTable +
    `\n` +
    `\n` +
    `## HTTP ステータスコードマッピング\n` +
    `\n` +
    `> ⚠️ 現状は未統一。下記は設計上の期待値であり、各 route が個別に HTTP ステータスを決定している。\n` +
    `> 503 を返す統一 middleware の実装は別起票（懸念バックログ）で追跡する。\n` +
    `\n` +
    `| エラー種別 | 期待 HTTP ステータス | 実装状況 |\n` +
    `| --- | --- | --- |\n` +
    `| Orchestrator シャットダウン | 503 Service Unavailable | 未統一（各 route 次第） |\n` +
    `| Worker シャットダウン | 503 Service Unavailable | 未統一（各 route 次第） |\n` +
    `\n` +
    `## 検出ロジック (isShutdownError)\n` +
    `\n` +
    `| 入力 | 結果 | 理由 |\n` +
    `| --- | --- | --- |\n` +
    `| \`Error('${WORKER_SHUTDOWN_ERROR_MESSAGE}')\` | \`true\` | \`WORKER_SHUTDOWN_ERROR_MESSAGE\` 完全一致 |\n` +
    `| \`Error('${SHUTDOWN_ERROR_MESSAGE}')\` | \`true\` | \`SHUTDOWN_ERROR_MESSAGE\` 前方一致 |\n` +
    allActionsRows +
    `\n` +
    `| \`Error('${WORKER_SHUTDOWN_ERROR_MESSAGE} — extra text')\` | \`false\` | Worker メッセージは完全一致のみ |\n` +
    `| \`'${SHUTDOWN_ERROR_MESSAGE}'\` (string) | \`false\` | \`instanceof Error\` ではない |\n` +
    `| \`null\` / \`undefined\` | \`false\` | \`instanceof Error\` ではない |\n`
  );
}

// ---------------------------------------------------------------------------
// Drift check
// ---------------------------------------------------------------------------

/** Represents a single file that is out of sync with what the generator would produce. */
export interface DriftResult {
  /** Absolute path to the file. */
  file: string;
  /** 'missing' when the file does not exist on disk; 'mismatch' when content differs. */
  status: 'missing' | 'mismatch';
}

/**
 * Compares the deterministic generated artifacts against what is on disk.
 * The changelog is intentionally excluded because it contains timestamps.
 *
 * @returns Array of DriftResult for each out-of-sync file (empty = no drift)
 */
export function checkDrift(): DriftResult[] {
  const results: DriftResult[] = [];

  const checks: Array<{ path: string; content: string }> = [
    { path: GENERATED_TEST_PATH, content: generateTestFileContent() },
    { path: SPEC_PATH, content: generateSpecContent() },
  ];

  for (const { path, content } of checks) {
    if (!existsSync(path)) {
      results.push({ file: path, status: 'missing' });
      continue;
    }
    const actual = readFileSync(path, 'utf-8');
    if (actual !== content) {
      results.push({ file: path, status: 'mismatch' });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Changelog helpers
// ---------------------------------------------------------------------------

function computeSsotHash(): string {
  const payload = JSON.stringify({
    SHUTDOWN_ACTIONS: [...SHUTDOWN_ACTIONS],
    SHUTDOWN_ERROR_MESSAGE,
    WORKER_SHUTDOWN_ERROR_MESSAGE,
  });
  return createHash('sha256').update(payload, 'utf-8').digest('hex').slice(0, 8);
}

/**
 * Appends an entry to the changelog when the SSOT content hash has changed since
 * the last entry. Uses a hidden HTML comment as the hash marker so the changelog
 * is human-readable and machine-verifiable.
 *
 * @param date - ISO date string for the entry (YYYY-MM-DD) / エントリの日付
 */
export function updateChangelog(date: string): void {
  const hash = computeSsotHash();
  const hashMarker = `<!-- hash:${hash} -->`;

  let existing = '';
  if (existsSync(CHANGELOG_PATH)) {
    existing = readFileSync(CHANGELOG_PATH, 'utf-8');
  }

  if (existing.includes(hashMarker)) {
    return; // No change since last entry
  }

  const entry =
    `\n## [${date}] ${hashMarker}\n` +
    `\n` +
    `- \`SHUTDOWN_ACTIONS\`: ${JSON.stringify([...SHUTDOWN_ACTIONS])}\n` +
    `- \`SHUTDOWN_ERROR_MESSAGE\`: \`'${SHUTDOWN_ERROR_MESSAGE}'\`\n` +
    `- \`WORKER_SHUTDOWN_ERROR_MESSAGE\`: \`'${WORKER_SHUTDOWN_ERROR_MESSAGE}'\`\n`;

  if (!existing) {
    const header =
      `# shutdown-error 変更ログ\n` +
      `\n` +
      `> 自動追記ファイル — 定数変更後に \`bun run gen:shutdown-error\` を実行すると追記されます。\n` +
      `> タイムスタンプを含むため \`--check\` のドリフト比較からは除外されます。\n`;
    writeFileSync(CHANGELOG_PATH, header + entry, 'utf-8');
  } else {
    writeFileSync(CHANGELOG_PATH, existing + entry, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// File write helpers
// ---------------------------------------------------------------------------

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const CHECK_MODE = process.argv.includes('--check');

  if (CHECK_MODE) {
    const drifts = checkDrift();
    if (drifts.length === 0) {
      console.log('shutdown-error artifacts: no drift detected.');
      process.exit(0);
    } else {
      for (const d of drifts) {
        console.error(`DRIFT [${d.status}]: ${d.file}`);
      }
      console.error(
        `\nRun \`bun run gen:shutdown-error\` to regenerate and commit the updated files.`,
      );
      process.exit(1);
    }
  } else {
    // Generate mode
    const today = new Date().toISOString().slice(0, 10);

    // 1. Generated test
    ensureDir(GENERATED_TEST_PATH);
    writeFileSync(GENERATED_TEST_PATH, generateTestFileContent(), 'utf-8');
    console.log(`Generated: ${GENERATED_TEST_PATH}`);

    // 2. Spec doc
    ensureDir(SPEC_PATH);
    writeFileSync(SPEC_PATH, generateSpecContent(), 'utf-8');
    console.log(`Generated: ${SPEC_PATH}`);

    // 3. Changelog (append-only)
    ensureDir(CHANGELOG_PATH);
    updateChangelog(today);
    console.log(`Updated: ${CHANGELOG_PATH}`);

    console.log('\nDone. Commit the generated files to keep the repository in sync.');
  }
}
