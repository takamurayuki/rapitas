#!/usr/bin/env bun
/**
 * 開発用スクリプト
 * - TypeScriptファイルの変更を検出してサーバーを自動再起動
 * - Prismaスキーマの変更を検出して自動的にdb pushとgenerateを実行
 */

import { spawn, type Subprocess } from "bun";
import { watch, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const PRISMA_SCHEMA = join(ROOT_DIR, "prisma", "schema.prisma");
const INDEX_FILE = join(ROOT_DIR, "index.ts");
const ENV_FILE = join(ROOT_DIR, ".env");

// .envファイルを読み込んで環境変数に設定
function loadEnvFile() {
  if (existsSync(ENV_FILE)) {
    const envContent = readFileSync(ENV_FILE, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key && valueParts.length > 0) {
          const value = valueParts.join("=").trim();
          // 既存の環境変数を上書きしない
          if (!process.env[key]) {
            process.env[key] = value.replace(/^["']|["']$/g, ""); // クォートを除去
          }
        }
      }
    }
    console.log(`[DEV] Loaded environment variables from .env`);
  }
}

// 起動時に.envを読み込む
loadEnvFile();

let serverProcess: Subprocess | null = null;
let isRestarting = false;
let restartTimeout: ReturnType<typeof setTimeout> | null = null;

// 色付きログ出力
const log = {
  info: (msg: string) => console.log(`\x1b[36m[DEV]\x1b[0m ${msg}`),
  success: (msg: string) => console.log(`\x1b[32m[DEV]\x1b[0m ${msg}`),
  warn: (msg: string) => console.log(`\x1b[33m[DEV]\x1b[0m ${msg}`),
  error: (msg: string) => console.log(`\x1b[31m[DEV]\x1b[0m ${msg}`),
};

// サーバープロセスを強制終了（開発用：グレースフルシャットダウンを待たない）
async function killServerProcess(): Promise<void> {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  // まずSIGTERMを送信
  proc.kill();

  // 2秒以内に終了しなければ強制終了
  const forceKillTimeout = setTimeout(() => {
    try {
      proc.kill(9); // SIGKILL
      log.warn("サーバーを強制終了しました（シャットダウンタイムアウト）");
    } catch {
      // 既に終了している
    }
  }, 2000);

  await proc.exited;
  clearTimeout(forceKillTimeout);
}

// サーバープロセスを開始
async function startServer() {
  if (serverProcess) {
    log.info("サーバーを停止中...");
    await killServerProcess();
    log.info("サーバーが停止しました");
  }

  log.info("サーバーを起動中...");
  serverProcess = spawn({
    cmd: ["bun", "run", INDEX_FILE],
    cwd: ROOT_DIR,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  log.success(`サーバー起動完了 (http://localhost:${process.env.PORT || "3001"})`);
}

// Prismaスキーマの変更を処理
async function handlePrismaChange() {
  log.info("Prismaスキーマの変更を検出...");

  try {
    // db push を実行
    log.info("prisma db push を実行中...");
    const pushResult = spawn({
      cmd: ["bunx", "prisma", "db", "push", "--skip-generate"],
      cwd: ROOT_DIR,
      stdio: ["inherit", "inherit", "inherit"],
    });
    await pushResult.exited;

    if (pushResult.exitCode !== 0) {
      log.error("prisma db push が失敗しました");
      return;
    }

    // generate を実行
    log.info("prisma generate を実行中...");
    const generateResult = spawn({
      cmd: ["bunx", "prisma", "generate"],
      cwd: ROOT_DIR,
      stdio: ["inherit", "inherit", "inherit"],
    });
    await generateResult.exited;

    if (generateResult.exitCode !== 0) {
      log.error("prisma generate が失敗しました");
      return;
    }

    log.success("Prismaスキーマの更新完了");

    // サーバーを再起動
    await startServer();
  } catch (error) {
    log.error(`Prisma処理エラー: ${error}`);
  }
}

// デバウンス付きでサーバーを再起動
function scheduleRestart() {
  if (restartTimeout) {
    clearTimeout(restartTimeout);
  }

  restartTimeout = setTimeout(async () => {
    if (isRestarting) return;
    isRestarting = true;

    try {
      await startServer();
    } finally {
      isRestarting = false;
    }
  }, 300); // 300ms のデバウンス
}

// TypeScriptファイルの監視
function watchTypeScriptFiles() {
  const watchDirs = ["services", "utils", "routes", "config", "middleware"];

  // index.ts を監視
  watch(INDEX_FILE, (eventType) => {
    if (eventType === "change") {
      log.info("index.ts の変更を検出");
      scheduleRestart();
    }
  });

  // 各ディレクトリを監視
  for (const dirName of watchDirs) {
    const dirPath = join(ROOT_DIR, dirName);
    try {
      watch(dirPath, { recursive: true }, (eventType, filename) => {
        if (filename?.endsWith(".ts")) {
          log.info(`${dirName}/${filename} の変更を検出`);
          scheduleRestart();
        }
      });
    } catch {
      // ディレクトリが存在しない場合は無視
    }
  }

  log.info("TypeScriptファイルの監視を開始");
  log.info(`監視対象: index.ts, ${watchDirs.join(", ")}`);
}

// Prismaスキーマの監視
function watchPrismaSchema() {
  let lastChangeTime = 0;

  watch(PRISMA_SCHEMA, async (eventType) => {
    if (eventType === "change") {
      // 連続した変更イベントをデバウンス
      const now = Date.now();
      if (now - lastChangeTime < 1000) return;
      lastChangeTime = now;

      await handlePrismaChange();
    }
  });

  log.info("Prismaスキーマの監視を開始");
}

// クリーンアップ処理
function cleanup() {
  log.info("終了処理中...");
  if (serverProcess) {
    serverProcess.kill();
  }
  process.exit(0);
}

// シグナルハンドラ
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// メイン処理
async function main() {
  console.log("");
  console.log("╔════════════════════════════════════════════╗");
  console.log("║     Rapitas Backend 開発サーバー           ║");
  console.log("╠════════════════════════════════════════════╣");
  console.log("║  • TypeScriptファイル変更 → 自動再起動     ║");
  console.log("║  • Prismaスキーマ変更 → 自動db push        ║");
  console.log("║  • Ctrl+C で終了                           ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log("");

  // 初回起動時にPrismaの同期を確認
  log.info("初回起動: Prismaスキーマを同期中...");
  const pushResult = spawn({
    cmd: ["bunx", "prisma", "db", "push"],
    cwd: ROOT_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });
  await pushResult.exited;

  // ファイル監視を開始
  watchTypeScriptFiles();
  watchPrismaSchema();

  // サーバーを起動
  await startServer();
}

main().catch((error) => {
  log.error(`起動エラー: ${error}`);
  process.exit(1);
});
