#!/usr/bin/env node
/**
 * 開発モード用スクリプト
 * フロントエンドとバックエンドを並行して起動
 * 開発時はNext.js開発サーバー(localhost:3000)のホットリロードを使用
 *
 * ポート管理:
 *   - 起動前にポート 3001/3000 の競合を自動検出・解消
 *   - 生きたプロセスは taskkill /T でツリーごと終了
 *   - ゾンビソケット(プロセス死亡後もカーネルに残る)検出時はフォールバックポートに自動切替
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
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
    const result = execSync(`netstat -aon | findstr ":${port} " | findstr "LISTEN"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * 指定ポートを使用しているプロセスを検出し、プロセスツリーごと終了させる
 * @returns {boolean} 競合が検出されたか
 */
function killProcessOnPort(port) {
  try {
    const result = execSync(`netstat -aon | findstr ":${port} " | findstr "LISTEN"`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const pids = new Set();
    for (const line of result.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parseInt(parts[parts.length - 1]);
      if (pid && pid > 0) pids.add(pid);
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
        console.log(`  Killed process tree PID ${pid} on port ${port}`);
      } catch {
        console.log(`  PID ${pid} on port ${port}: zombie socket (process already dead)`);
      }
    }

    return pids.size > 0;
  } catch {
    return false;
  }
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
 * HTTPリクエストでバックエンドのグレースフルシャットダウンを試行する
 * ポートクリーンアップ時に使用
 */
async function tryGracefulShutdownViaHttp(port) {
  try {
    const http = require('http');
    await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: 'localhost',
        port: port,
        path: '/agents/shutdown',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          console.log(`  Graceful shutdown requested on port ${port} (status: ${res.statusCode})`);
          resolve(data);
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
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
 * 5. 最終手段としてフォールバックポートに切り替え
 * @returns {Promise<number>} 使用するポート番号
 */
async function ensurePortAvailable(port) {
  if (!isPortListening(port)) return port;

  console.log(`  Port ${port} is in use, attempting cleanup...`);

  // バックエンドポートの場合、まずグレースフルシャットダウンを試行
  if (port === BACKEND_PORT || port === BACKEND_PORT + 1) {
    const shutdownRequested = await tryGracefulShutdownViaHttp(port);
    if (shutdownRequested) {
      // グレースフルシャットダウンの完了を待つ（最大15秒）
      try {
        await waitForPortRelease(port, 15000);
        console.log(`  Port ${port} released after graceful shutdown.`);
        return port;
      } catch {
        console.log(`  Graceful shutdown did not release port in time, forcing...`);
      }
    }
  }

  // リトライ付きで確実にプロセスを停止（ツリーkill）
  const released = forceKillAllOnPort(port);
  if (released) {
    console.log(`  Port ${port} is now available.`);
    return port;
  }

  // ツリーkillで失敗した場合、直接PID kill（/T なし）を試行
  console.log(`  Tree kill failed, attempting direct PID kill on port ${port}...`);
  const pids = getProcessesOnPort(port);
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
      console.log(`  Direct-killed PID ${pid} on port ${port}`);
    } catch {}
  }

  // forceKill 後、ソケットの解放を十分に待つ（最大15秒）
  try {
    await waitForPortRelease(port, 15000);
    console.log(`  Port ${port} is now available (after wait).`);
    return port;
  } catch {
    // プロセスを終了してもソケットが残っている = ゾンビ
    const fallback = port + 1;
    console.log(`  ⚠️  Port ${port} has zombie sockets (will auto-clear after ~2min).`);
    console.log(`  → Using fallback port ${fallback}`);

    if (isPortListening(fallback)) {
      forceKillAllOnPort(fallback);
      try {
        await waitForPortRelease(fallback, 10000);
      } catch {
        console.error(`  ❌ Port ${fallback} also unavailable. Please wait a few minutes or restart your PC.`);
        process.exit(1);
      }
    }
    return fallback;
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
    execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
  } catch {
    // ツリーkill失敗時は直接killを試行
    try { childProcess.kill('SIGKILL'); } catch {}
  }

  // Step 2: wmic で子プロセスを列挙し、残っていれば個別にkill
  // shell: true の場合、cmd.exe の子として実際のbun/nodeプロセスが起動される
  try {
    const wmicResult = execSync(
      `wmic process where (ParentProcessId=${pid}) get ProcessId /format:list`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    for (const line of wmicResult.split('\n')) {
      const match = line.match(/ProcessId=(\d+)/);
      if (match) {
        const childPid = parseInt(match[1]);
        try {
          execSync(`taskkill /F /T /PID ${childPid}`, { stdio: 'pipe' });
          console.log(`  Killed child process PID ${childPid} (parent: ${pid})`);
        } catch {}
      }
    }
  } catch {
    // wmic が使えない環境では無視
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
    // LISTEN状態のプロセスを検索
    const result = execSync(`netstat -aon | findstr ":${port} "`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    for (const line of result.trim().split('\n')) {
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
 * 指定ポートを使用しているすべてのプロセスを確実に終了する（リトライ付き）
 * killProcessTree で取りこぼしたプロセスをポート番号から確実に回収する
 * @param {number} port
 * @param {number} maxRetries 最大リトライ回数
 */
function forceKillAllOnPort(port, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (!isPortListening(port)) return true;

    const pids = getProcessesOnPort(port);
    if (pids.size === 0) return true;

    for (const pid of pids) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'pipe' });
        console.log(`  Killed PID ${pid} on port ${port} (attempt ${attempt + 1})`);
      } catch {
        // プロセスが既に終了している場合は無視
      }
    }

    // kill後にソケット解放を待つ（Windows TCPスタックがソケットを解放するまでのラグ対策）
    sleepSync(1000);
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
    childProcess.on('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

// ─── メイン処理 ───

const args = process.argv.slice(2);
const useWatch = args.includes('--watch');

const FRONTEND_DIR = path.resolve(__dirname, '../../rapitas-frontend');
const BACKEND_DIR = path.resolve(__dirname, '../../rapitas-backend');
const BINARIES_DIR = path.resolve(__dirname, '../src-tauri/binaries');

if (useWatch) {
  console.log('Starting development servers for Tauri (PostgreSQL) with HOT RELOAD...');
  console.log('⚠️  注意: ファイル変更時にバックエンドが再起動します。AIエージェント実行中は中断される可能性があります。');
} else {
  console.log('Starting development servers for Tauri (PostgreSQL) in STABLE mode...');
  console.log('ℹ️  バックエンドのホットリロードは無効です。コード変更後は手動で再起動してください。');
  console.log('ℹ️  ホットリロードを有効にするには: node scripts/dev.js --watch');
}

// 開発モード用にダミーのsidecarバイナリを作成（Tauriがパスを検証するため）
const targetTriple = 'x86_64-pc-windows-msvc';
const dummyBinaryPath = path.join(BINARIES_DIR, `rapitas-backend-${targetTriple}.exe`);

if (!fs.existsSync(BINARIES_DIR)) {
  fs.mkdirSync(BINARIES_DIR, { recursive: true });
}

if (!fs.existsSync(dummyBinaryPath)) {
  console.log('Creating dummy sidecar binary for development...');
  fs.writeFileSync(dummyBinaryPath, '');
  console.log(`Created: ${dummyBinaryPath}`);
}

// 開発モード用にダミーの.next-tauriディレクトリを作成
const NEXT_TAURI_DIR = path.join(FRONTEND_DIR, '.next-tauri');
if (!fs.existsSync(NEXT_TAURI_DIR)) {
  console.log('Creating dummy .next-tauri directory for development...');
  fs.mkdirSync(NEXT_TAURI_DIR, { recursive: true });
  fs.writeFileSync(path.join(NEXT_TAURI_DIR, 'index.html'), '<!-- Dummy file for Tauri dev mode -->');
  console.log(`Created: ${NEXT_TAURI_DIR}`);
}

let backend = null;
let frontend = null;
let actualBackendPort = BACKEND_PORT;
let actualFrontendPort = FRONTEND_PORT;

/**
 * データベーススキーマの同期とPrisma Client生成
 */
function syncDatabaseAndGenerateClient() {
  console.log('\nSyncing database schema...');
  try {
    execSync('bunx prisma db push --skip-generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
    console.log('Database schema synced.');
  } catch (err) {
    console.error('Failed to sync database schema:', err.message);
    console.log('⚠️  PostgreSQLが起動していることを確認してください。');
    throw err;
  }

  console.log('Generating Prisma Client...');
  try {
    execSync('bun run db:generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to generate Prisma Client:', err.message);
    throw err;
  }
}

// 再起動要求を示す終了コード
const RESTART_EXIT_CODE = 75;

/**
 * バックエンドプロセスを起動する
 */
function startBackend() {
  const backendScript = useWatch ? 'dev:simple' : 'dev:stable';
  console.log(`\nBackend mode: ${useWatch ? 'dev:simple (hot reload)' : 'dev:stable (stable)'}`);

  backend = spawn('bun', ['run', backendScript], {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      TAURI_BUILD: 'true',
      PORT: String(actualBackendPort),
    }
  });

  backend.on('error', (err) => console.error('Backend error:', err));

  // 再起動要求の終了コードを監視
  backend.on('exit', (code) => {
    if (isCleaningUp) return; // cleanup中の終了は無視
    if (code === RESTART_EXIT_CODE) {
      console.log(`\n🔄 Backend exited with restart code (${RESTART_EXIT_CODE}), initiating restart...`);
      // プロセスは既に終了済みなのでシャットダウンAPIの呼び出しをスキップ
      restartBackend(true).catch((err) => {
        console.error('❌ Backend restart failed:', err);
      });
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
    console.log('  Requesting graceful shutdown of backend...');

    // HTTPでシャットダウンAPIを呼び出す
    try {
      const http = require('http');
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port: actualBackendPort,
          path: '/agents/shutdown',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            console.log(`  Shutdown API response: ${res.statusCode}`);
            resolve(data);
          });
        });
        req.on('error', (err) => {
          console.log(`  Shutdown API unavailable (${err.code || err.message}), will force stop`);
          reject(err);
        });
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('timeout'));
        });
        req.end();
      });

      // プロセスの終了を待機（最大15秒）
      console.log('  Waiting for backend process to exit...');
      const exited = await waitForProcessExit(backend, 15000);
      if (!exited) {
        console.log('  Backend did not exit in time, forcing stop...');
        killProcessTree(backend);
      } else {
        console.log('  Backend stopped gracefully.');
      }
    } catch {
      // シャットダウンAPIが応答しない場合はフォールバック: 強制終了
      if (isRunning) {
        killProcessTree(backend);
        console.log('  Backend force-stopped.');
      }
    }
  } else if (!isRunning) {
    console.log('  Backend process already exited.');
  }

  // ポートが完全に解放されるまで待機
  try {
    await waitForPortRelease(actualBackendPort, 20000);
    console.log(`  Port ${actualBackendPort} released successfully.`);
  } catch {
    console.log(`  Port ${actualBackendPort} not yet released, forcing cleanup...`);
    const released = forceKillAllOnPort(actualBackendPort);
    if (released) {
      console.log(`  Port ${actualBackendPort} released after force cleanup.`);
    } else {
      console.log(`  Port ${actualBackendPort} still not released (will auto-clear).`);
    }
  }

  backend = null;
}

/**
 * バックエンドを再起動する（完全停止 → DB同期 → 起動）
 * @param {boolean} processAlreadyExited - trueの場合、プロセスが既に終了済み（シャットダウンAPIスキップ）
 */
async function restartBackend(processAlreadyExited = false) {
  console.log('\n🔄 Restarting backend server...');
  console.log('  Step 1/3: Stopping backend completely...');
  await stopBackendCompletely(processAlreadyExited);

  console.log('  Step 2/3: Syncing database and generating Prisma Client...');
  try {
    syncDatabaseAndGenerateClient();
  } catch (err) {
    console.error('❌ Failed to sync database during restart:', err.message);
    console.log('  Attempting to start backend without DB sync...');
  }

  console.log('  Step 3/3: Starting backend...');
  startBackend();
  console.log('✅ Backend restart completed.');
}

async function main() {
  // ポートのクリーンアップ（前回クラッシュ時のゾンビプロセス対策）
  console.log('\nChecking ports...');
  actualBackendPort = await ensurePortAvailable(BACKEND_PORT);
  actualFrontendPort = await ensurePortAvailable(FRONTEND_PORT);

  syncDatabaseAndGenerateClient();
  startBackend();

  // フロントエンドを起動
  frontend = spawn('pnpm', ['run', 'dev'], {
    cwd: FRONTEND_DIR,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      PORT: String(actualFrontendPort),
      NEXT_PUBLIC_API_BASE_URL: `http://localhost:${actualBackendPort}`,
    }
  });

  console.log(`\n🖥️  Development mode: Backend :${actualBackendPort}, Frontend :${actualFrontendPort}`);
  console.log('ℹ️  Changes will be reflected via hot reload (no rebuild needed)');

  frontend.on('error', (err) => console.error('Frontend error:', err));
}

// プロセス終了時のクリーンアップ
let isCleaningUp = false;

/**
 * 同期的クリーンアップ処理
 * Windows環境ではSIGINTハンドラ内の非同期処理が中断されるため、
 * すべて execSync ベースの同期処理で行う。
 *
 * 三段構えの停止戦略:
 *   1. 子プロセスの PID ツリーを taskkill で停止
 *   2. ポート番号から残存プロセスを検索・停止（取りこぼし対策）
 *   3. 最終確認: ポートがまだ使用中なら追加でkillを試行
 */
function cleanupSync() {
  if (isCleaningUp) return;
  isCleaningUp = true;

  console.log('\nStopping development servers...');

  // Step 1: 子プロセスツリーを停止
  console.log('  Step 1: Killing child process trees...');
  killProcessTree(backend);
  killProcessTree(frontend);

  // 子プロセスkill後、ソケット解放を少し待つ
  sleepSync(500);

  // Step 2: ポートベースで残存プロセスを停止（子プロセスkillで漏れた孫プロセス対策）
  console.log('  Step 2: Ensuring ports are released...');

  const portsToClean = new Set([
    actualBackendPort,
    actualFrontendPort,
    BACKEND_PORT,
    FRONTEND_PORT,
  ]);

  for (const port of portsToClean) {
    if (isPortListening(port)) {
      console.log(`  Port ${port} still in use, force killing...`);
      forceKillAllOnPort(port);
    }
  }

  // Step 3: 最終確認 - まだ残っている場合は個別PIDを直接killして待機
  console.log('  Step 3: Final verification...');
  let allClean = true;
  for (const port of portsToClean) {
    if (isPortListening(port)) {
      allClean = false;
      const pids = getProcessesOnPort(port);
      for (const pid of pids) {
        try {
          // /T なしで直接PIDのみkill（ツリーkillが失敗した場合の補完）
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'pipe' });
          console.log(`  Direct-killed PID ${pid} on port ${port}`);
        } catch {}
      }
      sleepSync(1000);
      if (isPortListening(port)) {
        console.log(`  ⚠️  Port ${port} could not be released (zombie socket, will auto-clear in ~2min).`);
      } else {
        console.log(`  Port ${port} released after direct kill.`);
      }
    } else {
      console.log(`  Port ${port} is free.`);
    }
  }

  if (allClean) {
    console.log('  All ports released successfully.');
  }

  console.log('  Cleanup completed.');
}

process.on('SIGINT', () => {
  cleanupSync();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanupSync();
  process.exit(0);
});
process.on('exit', () => {
  // exit イベントでは非同期処理不可なので同期的にクリーンアップ
  // SIGINT/SIGTERM で既にクリーンアップ済みなら isCleaningUp=true でスキップされる
  cleanupSync();
});

main().catch((err) => {
  console.error('Failed to start development servers:', err);
  process.exit(1);
});
