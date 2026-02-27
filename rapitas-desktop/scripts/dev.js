#!/usr/bin/env node
/**
 * 開発モード用スクリプト
 * フロントエンドとバックエンドを並行して起動
 * 開発時はNext.js開発サーバー(localhost:3000)のホットリロードを使用
 *
 * ポート管理:
 *   - 起動前にポート 3001/3000 の競合を自動検出・解消
 *   - グレースフルシャットダウン → ツリーkill → 直接PID kill の三段構え
 *   - バックエンドは reusePort: true でTIME_WAITソケットを無視してバインド可能
 *   - 終了時にプロセスツリーごとクリーンアップ（孤児プロセス防止）
 *
 * オプション:
 *   --watch    バックエンドのホットリロードを有効化（デフォルト: 無効）
 *              ※ AIエージェント実行中にファイル変更すると再起動で中断される
 *
 * 使用例:
 *   node scripts/dev.js          # 安定モード（AIエージェント実行向け）
 *   node scripts/dev.js --watch  # ホットリロードモード（バックエンド開発向け）
 */
const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BACKEND_PORT = 3001;
const FRONTEND_PORT = 3000;

// ─── ユーティリティ ───

/**
 * 同期的にスリープする（Windowsの timeout コマンドは不安定なため自前実装）
 * @param {number} ms ミリ秒
 */
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // busy wait（短時間のスリープ用途のみ）
  }
}

// ─── ポート管理ユーティリティ ───

/**
 * netstat でポートが LISTEN 状態のプロセスが存在するかチェック
 */
function isPortListening(port) {
  try {
    const result = execSync(
      `netstat -aon | findstr ":${port} " | findstr "LISTEN"`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * LISTEN状態のプロセスのPIDを取得する（有効なPID > 0のみ）
 * @returns {Set<number>} LISTEN状態のPIDセット
 */
function getListeningPids(port) {
  const pids = new Set();
  try {
    const result = execSync(
      `netstat -aon | findstr ":${port} " | findstr "LISTEN"`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    for (const line of result.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1]);
      // netstatに表示されていても実際に存在しないプロセス（ゾンビ）は除外
      if (pid && pid > 0 && isProcessRunning(pid)) {
        pids.add(pid);
      }
    }
  } catch {
    // findstr でヒットしなければ空
  }
  return pids;
}

/**
 * プロセスが実際に存在するかチェックする
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessRunning(pid) {
  try {
    const result = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    // 「情報: 指定された条件に一致するタスクは実行されていません。」または英語版
    if (
      result.includes("INFO:") ||
      result.includes("No tasks") ||
      result.includes("情報:")
    ) {
      return false;
    }
    return result.includes(String(pid));
  } catch {
    return false;
  }
}

/**
 * CLOSE_WAIT/FIN_WAIT_2 状態のゾンビソケットを所有するプロセスを検出・強制kill する
 * IPv6ゾンビソケットが LISTENING 状態で残り続ける問題への対策
 * PowerShell の Get-NetTCPConnection を使用して状態別にソケットを検出する
 * @param {number} port
 */
function killZombieSocketOwners(port) {
  try {
    // PowerShell で CLOSE_WAIT/FIN_WAIT_2/TIME_WAIT のソケット所有PIDを取得
    const psCommand = `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.State -in @('CloseWait','FinWait2','TimeWait') } | Select-Object -ExpandProperty OwningProcess -Unique`;
    const result = execSync(
      `powershell -NoProfile -Command "${psCommand}"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 10000 },
    );
    const pids = result
      .trim()
      .split("\n")
      .map((line) => parseInt(line.trim()))
      .filter((pid) => pid && pid > 0);

    if (pids.length === 0) return;

    console.log(
      `  Found zombie socket owner(s) on port ${port}: PID ${pids.join(", ")}`,
    );

    for (const pid of pids) {
      if (!isProcessRunning(pid)) {
        console.log(`  PID ${pid} is already dead (orphaned socket).`);
        continue;
      }
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
        console.log(`  Killed zombie socket owner PID ${pid}`);
      } catch (err) {
        const errMsg = err.message || err.stderr?.toString() || "";
        if (
          errMsg.includes("見つかりません") ||
          errMsg.includes("not found") ||
          errMsg.includes("not be found")
        ) {
          console.log(`  PID ${pid} already terminated.`);
        } else {
          console.log(`  Failed to kill PID ${pid}: ${errMsg}`);
        }
      }
    }
  } catch {
    // PowerShell が使えない or ポートにソケットがない場合は無視
  }
}

/**
 * 指定ポートを使用しているすべてのプロセスのPIDを取得する
 * LISTEN状態だけでなく、ESTABLISHED/TIME_WAIT等も含めて検出する
 * @param {number} port
 * @returns {Set<number>} PIDのセット
 */
function getProcessesOnPort(port) {
  const pids = new Set();
  try {
    const result = execSync(`netstat -aon | findstr ":${port} "`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const line of result.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1]);
      if (pid && pid > 0) pids.add(pid);
    }
  } catch {
    // netstat でヒットしなければ空
  }
  return pids;
}

/**
 * ポートが解放されるまでポーリングで待機する
 */
function waitForPortRelease(port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    function check() {
      if (!isPortListening(port)) {
        resolve();
      } else if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Port ${port} still occupied`));
      } else {
        setTimeout(check, 500);
      }
    }
    check();
  });
}

/**
 * バックエンド起動後にヘルスチェックを行い、実際にリクエストが処理できるか確認する
 * ゾンビソケットが残っていて接続が死んだソケットにルーティングされる場合を検出する
 * @param {number} port
 * @param {number} timeoutMs タイムアウト（ミリ秒）
 * @returns {Promise<boolean>} バックエンドが応答したか
 */
async function waitForBackendReady(port, timeoutMs = 30000) {
  const http = require("http");
  const startTime = Date.now();
  const pollInterval = 1000;

  // 最初の2秒はバックエンドの起動を待つ
  await new Promise((resolve) => setTimeout(resolve, 2000));

  while (Date.now() - startTime < timeoutMs) {
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(
          {
            hostname: "127.0.0.1", // IPv4明示（IPv6ゾンビソケット回避）
            port: port,
            path: "/tasks?limit=1",
            timeout: 5000,
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => { body += chunk; });
            res.on("end", () => {
              resolve(res.statusCode >= 200 && res.statusCode < 500);
            });
          },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
      });
      if (ok) {
        console.log(`  ✅ Backend health check passed (http://127.0.0.1:${port}/tasks)`);
        return true;
      }
    } catch {
      // リトライ
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.log(`  ⚠️  Backend health check timed out after ${timeoutMs / 1000}s`);
  return false;
}

/**
 * curl を使用して同期的にグレースフルシャットダウンを要求する
 * cleanupSync（同期的なクリーンアップ）から呼び出すために使用
 * @param {number} port
 * @returns {boolean} リクエストが成功したか
 */
function tryGracefulShutdownSync(port) {
  try {
    execSync(
      `curl -s -X POST -H "Content-Type: application/json" --connect-timeout 2 --max-time 3 http://localhost:${port}/agents/shutdown`,
      { stdio: "pipe", timeout: 5000 },
    );
    console.log(`  Graceful shutdown requested on port ${port} via curl.`);
    return true;
  } catch {
    // curl が使えないか、リクエストが失敗した場合はNode.js one-linerを試行
    try {
      execSync(
        `node -e "const h=require('http');const r=h.request({hostname:'localhost',port:${port},path:'/agents/shutdown',method:'POST',headers:{'Content-Type':'application/json'},timeout:3000},()=>process.exit(0));r.on('error',()=>process.exit(0));r.on('timeout',()=>{r.destroy();process.exit(0)});r.end()"`,
        { stdio: "pipe", timeout: 5000 },
      );
      console.log(`  Graceful shutdown requested on port ${port} via node.`);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * HTTPリクエスト（非同期）でバックエンドのグレースフルシャットダウンを試行する
 * ensurePortAvailable（非同期なポート確保）から呼び出すために使用
 */
async function tryGracefulShutdownViaHttp(port) {
  try {
    const http = require("http");
    await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: "localhost",
          port: port,
          path: "/agents/shutdown",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeout: 5000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            console.log(
              `  Graceful shutdown requested on port ${port} (status: ${res.statusCode})`,
            );
            resolve(data);
          });
          res.on("error", () => resolve(data)); // レスポンスエラーは無視
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("timeout"));
      });
      req.end();
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * ポートの確保
 * 1. バックエンドポートならグレースフルシャットダウンを試行
 * 2. プロセスが使用中 → forceKillAllOnPort でリトライ付きkill
 * 3. ポートベースkill + 直接PID kill の二段構え
 * 4. それでもダメなら waitForPortRelease でポーリング
 * 5. LISTEN状態のプロセスが無ければTIME_WAIT/CLOSE_WAITのみ → reusePortで対応可能なので続行
 * @returns {Promise<number>} 使用するポート番号
 */
async function ensurePortAvailable(port) {
  // まず CLOSE_WAIT/FIN_WAIT_2 のゾンビソケット所有プロセスを先にkill
  killZombieSocketOwners(port);

  if (!isPortListening(port)) return port;

  console.log(`  Port ${port} is in use, attempting cleanup...`);

  // LISTEN状態のPIDを特定してログ出力
  const listeningPids = getListeningPids(port);
  if (listeningPids.size > 0) {
    console.log(
      `  Found LISTENING process(es) on port ${port}: PID ${[...listeningPids].join(", ")}`,
    );
  }

  // バックエンドポートの場合、まずエージェント実行中かチェック
  if (port === BACKEND_PORT && isPortListening(port)) {
    console.log(`  Checking if agent is active on port ${port}...`);
    const agentActive = await isAgentExecutionActive();
    if (agentActive) {
      console.log(`  ⚠️  Agent execution detected on port ${port}!`);
      console.log(`  → Cannot shutdown active agent session. Exiting to prevent disruption.`);
      console.log(`  → Please wait for agent to complete or restart after agent finishes.`);
      process.exit(1);
    }

    console.log(`  No active agent detected. Attempting graceful shutdown on port ${port}...`);
    const shutdownRequested = await tryGracefulShutdownViaHttp(port);
    if (shutdownRequested) {
      // シャットダウンAPIはリスニングソケットを即座に閉じるので、短時間で解放されるはず
      try {
        await waitForPortRelease(port, 10000);
        console.log(`  Port ${port} released after graceful shutdown.`);
        return port;
      } catch {
        console.log(
          `  Graceful shutdown did not release port in time, forcing...`,
        );
      }
    } else {
      console.log(`  Graceful shutdown API not available, will force kill.`);
    }
  } else if (port === BACKEND_PORT) {
    // ポートがリスニング状態でない場合、バックエンドが動いていない
    console.log(`  Backend port ${port} is not in use, can start safely.`);
  }

  // リトライ付きで確実にプロセスを停止（ツリーkill）
  const released = forceKillAllOnPort(port);
  if (released) {
    console.log(`  Port ${port} is now available.`);
    return port;
  }

  // ツリーkillで失敗した場合、直接PID kill（/T なし）を試行
  console.log(
    `  Tree kill failed, attempting direct PID kill on port ${port}...`,
  );
  // 少し待って netstat の状態を更新させる
  sleepSync(500);
  const pids = getListeningPids(port);
  if (pids.size === 0) {
    console.log(
      `  No active processes found on port ${port} (may be zombie sockets).`,
    );
  }
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
      console.log(`  Direct-killed PID ${pid} on port ${port}`);
    } catch (err) {
      const errMsg = err.message || err.stderr?.toString() || "";
      // 「見つかりません」エラーはプロセスが既に終了しているので成功とみなす
      if (
        errMsg.includes("見つかりません") ||
        errMsg.includes("not found") ||
        errMsg.includes("not be found")
      ) {
        console.log(`  PID ${pid} already terminated.`);
      } else {
        console.log(
          `  Failed to kill PID ${pid}: ${errMsg || "unknown error"}`,
        );
      }
    }
  }

  // forceKill 後、ソケットの解放を十分に待つ（最大15秒）
  // Windows TCPスタックがポートを完全に解放するまでには時間がかかる
  sleepSync(1500);
  try {
    await waitForPortRelease(port, 15000);
    console.log(`  Port ${port} is now available (after wait).`);
    return port;
  } catch {
    // ポートが解放されなかった場合の最終チェック:
    // LISTEN状態のプロセスが残っているか確認
    const remainingPids = getListeningPids(port);
    if (remainingPids.size === 0) {
      // LISTEN状態のプロセスは無い = TIME_WAIT/CLOSE_WAITのゾンビソケットのみ
      // バックエンドは reusePort: true なのでバインド可能
      console.log(
        `  ⚠️  Port ${port} has zombie sockets (TIME_WAIT/CLOSE_WAIT) but no active listener.`,
      );
      console.log(
        `  → Proceeding anyway (backend uses reusePort for TIME_WAIT handling).`,
      );
      return port;
    }

    // LISTEN状態のプロセスがまだ残っている → 本当にkillできなかった
    console.log(
      `  ⚠️  Port ${port} still has active listener(s): PID ${[...remainingPids].join(", ")}`,
    );
    console.log(`  → Attempting one final kill with elevated wmic...`);

    // 最終手段: wmic process delete を試行
    for (const pid of remainingPids) {
      try {
        execSync(`wmic process where ProcessId=${pid} delete`, {
          stdio: "pipe",
          timeout: 5000,
        });
        console.log(`  Killed PID ${pid} via wmic.`);
      } catch {
        console.log(`  wmic kill failed for PID ${pid}.`);
      }
    }

    sleepSync(2000);

    if (!isPortListening(port)) {
      console.log(`  Port ${port} is now available (after wmic kill).`);
      return port;
    }

    // 本当にダメな場合はエラーメッセージを出すが、process.exit(1)はしない
    // reusePort により起動できる可能性があるため、試行を続行
    console.log(
      `  ❌ Could not fully release port ${port}. Will attempt to start anyway with reusePort.`,
    );
    return port;
  }
}

// ─── プロセス管理ユーティリティ ───

/**
 * プロセスツリーごとクリーンに終了させる (Windows: taskkill /T)
 * shell: true でspawnした場合、cmd.exe → 実プロセスの二段構造になるため、
 * ツリーkillに加えて子プロセスの列挙による補完も行う。
 */
function killProcessTree(childProcess) {
  if (!childProcess || childProcess.killed) return;
  const pid = childProcess.pid;
  if (!pid) return;

  // Step 1: ツリーkillで一括停止
  try {
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: "pipe" });
  } catch {
    // ツリーkill失敗時は直接killを試行
    try {
      childProcess.kill("SIGKILL");
    } catch {}
  }

  // Step 2: wmic で子プロセスを列挙し、残っていれば個別にkill
  // shell: true の場合、cmd.exe の子として実際のbun/nodeプロセスが起動される
  try {
    const wmicResult = execSync(
      `wmic process where (ParentProcessId=${pid}) get ProcessId /format:list`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
    for (const line of wmicResult.split("\n")) {
      const match = line.match(/ProcessId=(\d+)/);
      if (match) {
        const childPid = parseInt(match[1]);
        try {
          execSync(`taskkill /F /T /PID ${childPid}`, { stdio: "pipe" });
          console.log(
            `  Killed child process PID ${childPid} (parent: ${pid})`,
          );
        } catch {}
      }
    }
  } catch {
    // wmic が使えない環境では無視
  }
}

/**
 * 指定ポートを使用しているすべてのプロセスを確実に終了する（リトライ付き）
 * killProcessTree で取りこぼしたプロセスをポート番号から確実に回収する
 * @param {number} port
 * @param {number} maxRetries 最大リトライ回数
 */
function forceKillAllOnPort(port, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 判定前にnetstatキャッシュが更新されるのを待つ
    if (attempt > 0) sleepSync(500);

    if (!isPortListening(port)) return true;

    const pids = getListeningPids(port);
    if (pids.size === 0) {
      // netstatでは見えるがプロセスは存在しない = ゾンビソケット
      console.log(
        `  Port ${port} shows in netstat but no active process (zombie socket).`,
      );
      return true;
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "pipe" });
        console.log(
          `  Killed PID ${pid} on port ${port} (attempt ${attempt + 1})`,
        );
      } catch (err) {
        const errMsg = err.message || err.stderr?.toString() || "";
        // 「見つかりません」は成功とみなす
        if (
          errMsg.includes("見つかりません") ||
          errMsg.includes("not found") ||
          errMsg.includes("not be found")
        ) {
          console.log(`  PID ${pid} already terminated.`);
        }
        // それ以外のエラーは無視して続行
      }
    }

    // kill後にソケット解放を待つ（Windows TCPスタックがソケットを解放するまでのラグ対策）
    sleepSync(1500);
  }

  // 最終チェック: プロセスは存在しないがポートがまだ見える場合はゾンビソケット
  const finalPids = getListeningPids(port);
  if (finalPids.size === 0) {
    return true;
  }

  return !isPortListening(port);
}

/**
 * バックエンドプロセスが終了するまで待機する
 * @param {number} timeoutMs タイムアウト(ミリ秒)
 * @returns {Promise<boolean>} プロセスが正常に終了したか
 */
function waitForProcessExit(childProcess, timeoutMs = 15000) {
  if (!childProcess || childProcess.killed || childProcess.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
    childProcess.on("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// ─── メイン処理 ───

const args = process.argv.slice(2);
const useWatch = args.includes("--watch");

const FRONTEND_DIR = path.resolve(__dirname, "../../rapitas-frontend");
const BACKEND_DIR = path.resolve(__dirname, "../../rapitas-backend");
const BINARIES_DIR = path.resolve(__dirname, "../src-tauri/binaries");

if (useWatch) {
  console.log(
    "Starting development servers for Tauri (PostgreSQL) with HOT RELOAD...",
  );
  console.log(
    "⚠️  注意: ファイル変更時にバックエンドが再起動します。AIエージェント実行中は中断される可能性があります。",
  );
} else {
  console.log(
    "Starting development servers for Tauri (PostgreSQL) in STABLE mode...",
  );
  console.log(
    "ℹ️  バックエンドのホットリロードは無効です。コード変更後は手動で再起動してください。",
  );
  console.log(
    "ℹ️  ホットリロードを有効にするには: node scripts/dev.js --watch",
  );
}

// 開発モード用にダミーのsidecarバイナリを作成（Tauriがパスを検証するため）
const targetTriple = "x86_64-pc-windows-msvc";
const dummyBinaryPath = path.join(
  BINARIES_DIR,
  `rapitas-backend-${targetTriple}.exe`,
);

if (!fs.existsSync(BINARIES_DIR)) {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });
}

if (!fs.existsSync(dummyBinaryPath)) {
  console.log("Creating dummy sidecar binary for development...");
  fs.writeFileSync(dummyBinaryPath, "");
  console.log(`Created: ${dummyBinaryPath}`);
}

// 開発モード用にダミーの.next-tauriディレクトリを作成
const NEXT_TAURI_DIR = path.join(FRONTEND_DIR, ".next-tauri");
if (!fs.existsSync(NEXT_TAURI_DIR)) {
  console.log("Creating dummy .next-tauri directory for development...");
  fs.mkdirSync(NEXT_TAURI_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(NEXT_TAURI_DIR, "index.html"),
    "<!-- Dummy file for Tauri dev mode -->",
  );
  console.log(`Created: ${NEXT_TAURI_DIR}`);
}

let backend = null;
let frontend = null;
let actualBackendPort = BACKEND_PORT;
let actualFrontendPort = FRONTEND_PORT;
let isHotRestarting = false;
let fileWatchers = [];
let lastRestartCompletedAt = 0;

/**
 * データベーススキーマの同期とPrisma Client生成
 */
function syncDatabaseAndGenerateClient() {
  console.log("\nSyncing database schema...");
  try {
    execSync("bunx prisma db push --skip-generate --accept-data-loss", {
      cwd: BACKEND_DIR,
      stdio: "inherit",
    });
    console.log("Database schema synced.");
  } catch (err) {
    console.error("Failed to sync database schema:", err.message);
    console.log("⚠️  PostgreSQLが起動していることを確認してください。");
    throw err;
  }

  console.log("Generating Prisma Client...");
  try {
    execSync("bun run db:generate", { cwd: BACKEND_DIR, stdio: "inherit" });
  } catch (err) {
    console.error("Failed to generate Prisma Client:", err.message);
    throw err;
  }
}

// 再起動要求を示す終了コード
const RESTART_EXIT_CODE = 75;

// Bunクラッシュ（Segmentation fault等）を示す終了コード
const BUN_CRASH_EXIT_CODES = [134, 139]; // 134=SIGABRT, 139=SIGSEGV

// クラッシュリカバリの設定
const MAX_CRASH_RETRIES = 3;
const CRASH_RETRY_DELAY_MS = 2000;
const CRASH_WINDOW_MS = 30000; // この期間内のクラッシュ回数をカウント
let crashTimestamps = [];

/**
 * バックエンドプロセスを起動する
 * @param {number} retryCount - クラッシュリカバリのリトライ回数（内部使用）
 */
function startBackend(retryCount = 0) {
  // Always use dev:stable (no bun --watch) to ensure graceful shutdown handlers run
  const backendScript = "dev:stable";
  if (retryCount === 0) {
    console.log(
      `\nBackend mode: dev:stable ${useWatch ? "(fs.watch hot reload)" : "(stable)"}`,
    );
  } else {
    console.log(
      `\n🔄 Crash recovery attempt ${retryCount}/${MAX_CRASH_RETRIES}...`,
    );
  }

  backend = spawn("bun", ["run", backendScript], {
    cwd: BACKEND_DIR,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      TAURI_BUILD: "true",
      PORT: String(actualBackendPort),
    },
  });

  backend.on("error", (err) => console.error("Backend error:", err));

  // 再起動要求の終了コードとクラッシュリカバリを監視
  backend.on("exit", (code) => {
    if (isCleaningUp) return; // cleanup中の終了は無視
    if (code === RESTART_EXIT_CODE) {
      console.log(
        `\n🔄 Backend exited with restart code (${RESTART_EXIT_CODE}), initiating restart...`,
      );
      // プロセスは既に終了済みなのでシャットダウンAPIの呼び出しをスキップ
      restartBackend(true).catch((err) => {
        console.error("❌ Backend restart failed:", err);
      });
      return;
    }

    // Bunクラッシュ検出（Segmentation fault / SIGABRT）
    if (BUN_CRASH_EXIT_CODES.includes(code)) {
      const now = Date.now();
      // 古いクラッシュタイムスタンプを除去
      crashTimestamps = crashTimestamps.filter(
        (t) => now - t < CRASH_WINDOW_MS,
      );
      crashTimestamps.push(now);

      console.error(
        `\n⚠️ Bun crashed with exit code ${code} (Segmentation fault / runtime crash)`,
      );

      if (crashTimestamps.length <= MAX_CRASH_RETRIES) {
        console.log(
          `  Auto-recovering in ${CRASH_RETRY_DELAY_MS}ms... (crash ${crashTimestamps.length}/${MAX_CRASH_RETRIES} in last ${CRASH_WINDOW_MS / 1000}s)`,
        );
        backend = null;
        setTimeout(async () => {
          // ポートが解放されるのを待つ
          try {
            await waitForPortRelease(actualBackendPort, 5000);
          } catch {
            // ポート未解放でも試行
          }
          startBackend(crashTimestamps.length);
        }, CRASH_RETRY_DELAY_MS);
      } else {
        console.error(
          `\n❌ Bun crashed ${crashTimestamps.length} times in ${CRASH_WINDOW_MS / 1000}s. Stopping auto-recovery.`,
        );
        console.error(
          `  This is a known Bun runtime bug. Try upgrading Bun: bun upgrade`,
        );
      }
    }
  });
}

/**
 * バックエンドを完全に停止する（グレースフルシャットダウン→ポート解放確認）
 * @param {boolean} skipShutdownApi - trueの場合、プロセスが既に終了済みなのでシャットダウンAPIの呼び出しをスキップ
 */
async function stopBackendCompletely(skipShutdownApi = false) {
  const isRunning = backend && !backend.killed && backend.exitCode === null;

  if (!skipShutdownApi && isRunning) {
    console.log("  Requesting graceful shutdown of backend...");

    // HTTPでシャットダウンAPIを呼び出す
    try {
      const http = require("http");
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "localhost",
            port: actualBackendPort,
            path: "/agents/shutdown",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            timeout: 5000,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              console.log(`  Shutdown API response: ${res.statusCode}`);
              resolve(data);
            });
            res.on("error", () => resolve(data)); // レスポンスエラーは無視
          },
        );
        req.on("error", (err) => {
          if (err.code === "ECONNRESET") {
            // ECONNRESET = バックエンドがシャットダウンリクエストを受信し、
            // ソケットを閉じた可能性が高い。成功とみなしてプロセス終了を待つ。
            console.log(
              "  Shutdown request sent (connection reset - backend is shutting down)",
            );
            resolve("ECONNRESET");
          } else {
            console.log(
              `  Shutdown API unavailable (${err.code || err.message}), will force stop`,
            );
            reject(err);
          }
        });
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.end();
      });

      // プロセスの終了を待機（最大20秒 - グレースフルシャットダウンには時間がかかる）
      console.log("  Waiting for backend process to exit...");
      const exited = await waitForProcessExit(backend, 20000);
      if (!exited) {
        console.log("  Backend did not exit in time, forcing stop...");
        killProcessTree(backend);
        // 強制終了後、ソケットクリーンアップのために追加待機
        sleepSync(1500);
      } else {
        console.log("  Backend stopped gracefully.");
        // グレースフルシャットダウン後もソケットクリーンアップのために少し待機
        sleepSync(500);
      }
    } catch {
      // シャットダウンAPIが応答しない場合はフォールバック: 強制終了
      if (isRunning) {
        killProcessTree(backend);
        console.log("  Backend force-stopped.");
      }
    }
  } else if (!isRunning) {
    console.log("  Backend process already exited.");
  }

  // ポートが完全に解放されるまで待機
  try {
    await waitForPortRelease(actualBackendPort, 20000);
    console.log(`  Port ${actualBackendPort} released successfully.`);
  } catch {
    console.log(
      `  Port ${actualBackendPort} not yet released, forcing cleanup...`,
    );
    const released = forceKillAllOnPort(actualBackendPort);
    if (released) {
      console.log(`  Port ${actualBackendPort} released after force cleanup.`);
    } else {
      console.log(
        `  Port ${actualBackendPort} still not released (will auto-clear).`,
      );
    }
  }

  backend = null;
}

/**
 * バックエンドを再起動する（完全停止 → DB同期 → 起動）
 * @param {boolean} processAlreadyExited - trueの場合、プロセスが既に終了済み（シャットダウンAPIスキップ）
 */
async function restartBackend(processAlreadyExited = false) {
  console.log("\n🔄 Restarting backend server...");
  console.log("  Step 1/3: Stopping backend completely...");
  await stopBackendCompletely(processAlreadyExited);

  console.log("  Step 2/3: Syncing database and generating Prisma Client...");
  try {
    syncDatabaseAndGenerateClient();
  } catch (err) {
    console.error("❌ Failed to sync database during restart:", err.message);
    console.log("  Attempting to start backend without DB sync...");
  }

  console.log("  Step 3/3: Starting backend...");
  crashTimestamps = []; // フルリスタート時はクラッシュカウンターをリセット
  startBackend();
  console.log("✅ Backend restart completed.");
}

/**
 * バックエンドの /agents/system-status APIを呼び出し、
 * エージェント実行がアクティブかどうかをチェックする。
 * アクティブな場合、リスタートを抑制してエージェントの中断を防ぐ。
 * @returns {Promise<boolean>} エージェント実行中ならtrue
 */
async function isAgentExecutionActive() {
  try {
    const http = require("http");
    const data = await new Promise((resolve, reject) => {
      const req = http.get(
        {
          hostname: "localhost",
          port: actualBackendPort,
          path: "/agents/system-status",
          timeout: 3000,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(body));
            } catch {
              resolve(null);
            }
          });
        },
      );
      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
    });
    if (data && (data.activeExecutions > 0 || data.runningExecutions > 0)) {
      return true;
    }
    return false;
  } catch {
    // APIが応答しない場合は安全側に倒してリスタート許可
    return false;
  }
}

/**
 * ホットリスタート: DB同期をスキップした軽量リスタート
 * ファイル変更検出時に使用。stopBackendCompletely() でグレースフルシャットダウンを経由する。
 */
async function hotRestartBackend() {
  if (isHotRestarting) {
    console.log("  Hot restart already in progress, skipping...");
    return;
  }
  isHotRestarting = true;
  try {
    console.log("\n🔥 Hot-restarting backend server...");
    console.log("  Step 1/2: Stopping backend completely...");
    await stopBackendCompletely();

    console.log("  Step 2/2: Starting backend...");
    crashTimestamps = []; // ホットリスタート時はクラッシュカウンターをリセット
    startBackend();
    console.log("✅ Hot restart completed.");
  } catch (err) {
    console.error("❌ Hot restart failed:", err.message || err);
  } finally {
    isHotRestarting = false;
    lastRestartCompletedAt = Date.now();
  }
}

/**
 * バックエンドの .ts ファイル変更を監視し、変更検出時にホットリスタートを実行する
 * schema.prisma の変更時はDB同期付きの完全リスタートを実行する
 */
function startFileWatcher() {
  const watchDirs = [
    "index.ts",
    "services",
    "utils",
    "routes",
    "config",
    "middleware",
    "schemas",
    "types",
  ];

  let debounceTimer = null;
  let pendingPrismaRestart = false;

  let pendingChanges = [];

  function handleChange(filename) {
    if (!filename) return;
    // リスタート中 or クールダウン中（3秒）はイベントを無視
    if (isHotRestarting) return;
    if (Date.now() - lastRestartCompletedAt < 3000) return;
    // schema.prisma の変更はDB同期付きリスタート
    if (filename.endsWith("schema.prisma")) {
      pendingPrismaRestart = true;
    }
    // .ts ファイルまたは schema.prisma のみ対象
    if (!filename.endsWith(".ts") && !filename.endsWith("schema.prisma")) {
      return;
    }
    pendingChanges.push(filename);
    // デバウンス: 500ms以内の連続変更をまとめる
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const changes = [...pendingChanges];
      pendingChanges = [];
      const uniqueFiles = [...new Set(changes)].join(", ");
      console.log(`\n📁 File change detected: ${uniqueFiles}`);

      // エージェント実行中はリスタートを抑制
      const agentActive = await isAgentExecutionActive();
      if (agentActive) {
        console.log(
          "  ⏸️  Agent execution in progress, deferring restart. Changes will apply on next restart.",
        );
        return;
      }

      if (pendingPrismaRestart) {
        pendingPrismaRestart = false;
        console.log(
          "  Prisma schema changed, performing full restart with DB sync...",
        );
        await restartBackend().catch((err) => {
          console.error("❌ Full restart failed:", err.message || err);
        });
      } else {
        await hotRestartBackend();
      }
    }, 500);
  }

  // 各ディレクトリ/ファイルを監視
  for (const target of watchDirs) {
    const fullPath = path.join(BACKEND_DIR, target);
    if (!fs.existsSync(fullPath)) continue;

    try {
      const stat = fs.statSync(fullPath);
      const options = stat.isDirectory() ? { recursive: true } : {};

      const watcher = fs.watch(fullPath, options, (eventType, filename) => {
        // ディレクトリの場合はfilename付き、ファイルの場合はtarget自体
        const changedFile = filename || target;
        handleChange(changedFile);
      });

      watcher.on("error", (err) => {
        console.error(`  File watcher error for ${target}:`, err.message);
      });

      fileWatchers.push(watcher);
    } catch (err) {
      console.warn(`  Could not watch ${target}: ${err.message}`);
    }
  }

  // prisma ディレクトリも監視
  const prismaDir = path.join(BACKEND_DIR, "prisma");
  if (fs.existsSync(prismaDir)) {
    try {
      const watcher = fs.watch(
        prismaDir,
        { recursive: true },
        (eventType, filename) => {
          if (filename) handleChange(filename);
        },
      );
      watcher.on("error", (err) => {
        console.error(`  File watcher error for prisma/:`, err.message);
      });
      fileWatchers.push(watcher);
    } catch (err) {
      console.warn(`  Could not watch prisma/: ${err.message}`);
    }
  }

  console.log(
    `📂 File watcher started (watching ${fileWatchers.length} targets in backend)`,
  );
}

async function main() {
  // CI環境では実行しない
  if (process.env.CI === 'true' || process.env.CI === '1') {
    console.log("CI environment detected. Skipping dev server startup.");
    process.exit(0);
  }

  // ポートのクリーンアップ（前回クラッシュ時のゾンビプロセス対策）
  console.log("\nChecking ports...");
  actualBackendPort = await ensurePortAvailable(BACKEND_PORT);
  actualFrontendPort = await ensurePortAvailable(FRONTEND_PORT);

  syncDatabaseAndGenerateClient();
  startBackend();

  // バックエンドのヘルスチェック（ゾンビソケットへの接続を検出）
  const backendReady = await waitForBackendReady(actualBackendPort);
  if (!backendReady) {
    console.log("  ⚠️  Backend not responding. Attempting zombie socket cleanup and restart...");
    killZombieSocketOwners(actualBackendPort);
    // ポートを再確保してリスタート
    await stopBackendCompletely();
    actualBackendPort = await ensurePortAvailable(BACKEND_PORT);
    startBackend();
    const retryReady = await waitForBackendReady(actualBackendPort, 15000);
    if (!retryReady) {
      console.log("  ❌ Backend still not responding after retry. Continuing anyway...");
    }
  }

  // フロントエンドを起動
  frontend = spawn("pnpm", ["run", "dev"], {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      PORT: String(actualFrontendPort),
      NEXT_PUBLIC_API_BASE_URL: `http://localhost:${actualBackendPort}`,
    },
  });

  console.log(
    `\n🖥️  Development mode: Backend :${actualBackendPort}, Frontend :${actualFrontendPort}`,
  );
  console.log(
    "ℹ️  Changes will be reflected via hot reload (no rebuild needed)",
  );

  frontend.on("error", (err) => console.error("Frontend error:", err));

  // --watch モード時は fs.watch ベースのファイル監視を開始
  if (useWatch) {
    startFileWatcher();
  }
}

// プロセス終了時のクリーンアップ
let isCleaningUp = false;

/**
 * 同期的クリーンアップ処理
 * Windows環境ではSIGINTハンドラ内の非同期処理が中断されるため、
 * すべて execSync ベースの同期処理で行う。
 *
 * 四段構えの停止戦略:
 *   0. バックエンドにHTTPでグレースフルシャットダウンを要求（ソケットを正しく閉じるため）
 *   1. 子プロセスの PID ツリーを taskkill で停止
 *   2. ポート番号から残存プロセスを検索・停止（取りこぼし対策）
 *   3. 最終確認: ポートがまだ使用中なら追加でkillを試行
 */
function cleanupSync() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  // ファイルウォッチャーを先に閉じてリスタート競合を防止
  for (const watcher of fileWatchers) {
    try {
      watcher.close();
    } catch {}
  }
  fileWatchers = [];

  console.log("\nStopping development servers...");

  // Step 0: バックエンドにグレースフルシャットダウンを要求
  // これによりリスニングソケットが正しく閉じられ、次回起動時のポート競合を防止
  if (isPortListening(actualBackendPort)) {
    console.log("  Step 0: Requesting graceful shutdown via HTTP...");
    const shutdownOk = tryGracefulShutdownSync(actualBackendPort);
    if (shutdownOk) {
      // シャットダウンAPIはリスニングソケットを即座に閉じるので、十分に待つ
      // バックエンドがグレースフルに終了するまで最大4秒待機
      console.log("  Waiting for backend to complete graceful shutdown...");
      sleepSync(4000);
      if (!isPortListening(actualBackendPort)) {
        console.log("  Backend shut down gracefully, port released.");
        // フロントエンドも停止
        killProcessTree(frontend);
        console.log("  Cleanup completed.");
        return;
      }
      console.log(
        "  Port still in use after graceful shutdown, proceeding with force kill...",
      );
    } else {
      console.log(
        "  Graceful shutdown request failed, proceeding with force kill...",
      );
    }
  }

  // Step 1: 子プロセスツリーを停止
  console.log("  Step 1: Killing child process trees...");
  killProcessTree(backend);
  killProcessTree(frontend);

  // 子プロセスkill後、ソケット解放を少し待つ
  sleepSync(1000);

  // Step 2: ポートベースで残存プロセスを停止（子プロセスkillで漏れた孫プロセス対策）
  console.log("  Step 2: Ensuring ports are released...");

  const portsToClean = new Set([
    actualBackendPort,
    actualFrontendPort,
    BACKEND_PORT,
    FRONTEND_PORT,
  ]);

  for (const port of portsToClean) {
    // CLOSE_WAIT/FIN_WAIT_2 のゾンビソケット所有プロセスもkill
    killZombieSocketOwners(port);
    if (isPortListening(port)) {
      console.log(`  Port ${port} still in use, force killing...`);
      forceKillAllOnPort(port);
    }
  }

  // Step 3: 最終確認 - まだ残っている場合は個別PIDを直接killして待機
  console.log("  Step 3: Final verification...");
  let allClean = true;
  for (const port of portsToClean) {
    if (isPortListening(port)) {
      allClean = false;
      const pids = getListeningPids(port);
      for (const pid of pids) {
        try {
          // /T なしで直接PIDのみkill（ツリーkillが失敗した場合の補完）
          execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
          console.log(`  Direct-killed PID ${pid} on port ${port}`);
        } catch {}
      }
      sleepSync(1000);
      if (isPortListening(port)) {
        console.log(
          `  ⚠️  Port ${port} could not be released (zombie socket, will auto-clear in ~2min).`,
        );
      } else {
        console.log(`  Port ${port} released after direct kill.`);
      }
    } else {
      console.log(`  Port ${port} is free.`);
    }
  }

  if (allClean) {
    console.log("  All ports released successfully.");
  }

  console.log("  Cleanup completed.");
}

process.on("SIGINT", () => {
  cleanupSync();
  process.exit(0);
});
process.on("SIGTERM", () => {
  cleanupSync();
  process.exit(0);
});
process.on("exit", () => {
  // exit イベントでは非同期処理不可なので同期的にクリーンアップ
  // SIGINT/SIGTERM で既にクリーンアップ済みなら isCleaningUp=true でスキップされる
  cleanupSync();
});

// 未処理のPromise拒否でクラッシュしないようにする
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection in dev.js:", reason);
  // クラッシュせずにログのみ出力
});

main().catch((err) => {
  console.error("Failed to start development servers:", err);
  process.exit(1);
});
