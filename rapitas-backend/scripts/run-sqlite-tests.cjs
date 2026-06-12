#!/usr/bin/env node
/**
 * run-sqlite-tests.cjs
 *
 * SQLite 互換テストのみを選択実行するクロスプラットフォームランナー。
 * scripts/sqlite-compat-tests.txt のマニフェストを読み込み、
 * RAPITAS_DB_PROVIDER=sqlite 環境下で bun test を spawn する。
 * bun test の --tag オプション非対応・グロブの OS 差異を回避するため、
 * ファイルリストを spawn 引数として直接渡す方式を採用している。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** rapitas-backend ディレクトリ（このスクリプトの親） */
const BACKEND_DIR = path.resolve(__dirname, '..');

/** マニフェストファイルパス */
const MANIFEST_PATH = path.join(__dirname, 'sqlite-compat-tests.txt');

/**
 * マニフェストファイルを読み込んでテストファイルパスの配列を返す。
 * コメント行（# 始まり）と空行は無視する。
 *
 * @returns {string[]} テストファイルの相対パス一覧（BACKEND_DIR 基準）
 */
function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`[run-sqlite-tests] ERROR: Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(MANIFEST_PATH, 'utf8').split(/\r?\n/);
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * 各テストファイルの存在を検証し、1 件でも不在なら非 0 終了する。
 * マニフェストと実ファイルの乖離（drift）を CI で早期検知するため。
 *
 * @param {string[]} files - 検証対象ファイルパス一覧（BACKEND_DIR 基準）
 */
function validateFiles(files) {
  let hasError = false;
  for (const file of files) {
    const absPath = path.join(BACKEND_DIR, file);
    if (!fs.existsSync(absPath)) {
      console.error(`[run-sqlite-tests] ERROR: Test file not found: ${file}`);
      console.error(`  Expected at: ${absPath}`);
      console.error(`  Update ${MANIFEST_PATH} to remove or fix this entry.`);
      hasError = true;
    }
  }
  if (hasError) {
    process.exit(1);
  }
}

/**
 * SQLite 環境変数を含む子プロセス env を構築する。
 * DATABASE_URL は lint ジョブ（test-lint.yml:238）と同値を使用する。
 *
 * @returns {NodeJS.ProcessEnv} 環境変数オブジェクト
 */
function buildSQLiteEnv() {
  return {
    ...process.env,
    RAPITAS_DB_PROVIDER: 'sqlite',
    // NOTE: lint ジョブ（test-lint.yml:238）の実績値と一致させる
    DATABASE_URL: process.env.DATABASE_URL ?? 'file:./rapitas-ci.db',
  };
}

/**
 * bun test をファイルリスト指定で実行し、終了コードをそのまま返す。
 *
 * @param {string[]} files - テスト対象ファイル一覧（BACKEND_DIR 基準）
 * @param {NodeJS.ProcessEnv} env - 子プロセスに渡す環境変数
 * @returns {number} bun test の終了コード
 */
function runTests(files, env) {
  console.log('[run-sqlite-tests] SQLite compatible test suite');
  console.log(`[run-sqlite-tests] Running ${files.length} test file(s) with RAPITAS_DB_PROVIDER=sqlite`);
  for (const f of files) {
    console.log(`  - ${f}`);
  }
  console.log('');

  const result = spawnSync('bun', ['test', '--isolate', ...files], {
    stdio: 'inherit',
    env,
    cwd: BACKEND_DIR,
  });

  if (result.error) {
    console.error('[run-sqlite-tests] ERROR: Failed to spawn bun:', result.error.message);
    return 1;
  }

  return result.status ?? 1;
}

// --- main ---

const files = readManifest();

if (files.length === 0) {
  console.error('[run-sqlite-tests] ERROR: Manifest is empty — no test files to run.');
  console.error(`  Add SQLite-compatible test paths to: ${MANIFEST_PATH}`);
  process.exit(1);
}

validateFiles(files);

const env = buildSQLiteEnv();
const exitCode = runTests(files, env);

process.exit(exitCode);
