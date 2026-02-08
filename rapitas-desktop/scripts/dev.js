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
 * ポートの確保
 * 1. プロセスが使用中 → taskkill で終了 → 解放を待つ
 * 2. ゾンビソケット → フォールバックポートに切り替え
 * @returns {Promise<number>} 使用するポート番号
 */
async function ensurePortAvailable(port) {
  if (!isPortListening(port)) return port;

  console.log(`  Port ${port} is in use, attempting cleanup...`);
  killProcessOnPort(port);

  try {
    await waitForPortRelease(port, 5000);
    console.log(`  Port ${port} is now available.`);
    return port;
  } catch {
    // プロセスを終了してもソケットが残っている = ゾンビ
    const fallback = port + 1;
    console.log(`  ⚠️  Port ${port} has zombie sockets (will auto-clear after ~2min).`);
    console.log(`  → Using fallback port ${fallback}`);

    if (isPortListening(fallback)) {
      killProcessOnPort(fallback);
      try {
        await waitForPortRelease(fallback, 5000);
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
 */
function killProcessTree(childProcess) {
  if (!childProcess || childProcess.killed) return;
  try {
    execSync(`taskkill /F /T /PID ${childProcess.pid}`, { stdio: 'pipe' });
  } catch {
    try { childProcess.kill('SIGKILL'); } catch {}
  }
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

async function main() {
  // ポートのクリーンアップ（前回クラッシュ時のゾンビプロセス対策）
  console.log('\nChecking ports...');
  const actualBackendPort = await ensurePortAvailable(BACKEND_PORT);
  const actualFrontendPort = await ensurePortAvailable(FRONTEND_PORT);

  // データベーススキーマを同期してPrisma Clientを生成
  console.log('\nSyncing database schema...');
  try {
    execSync('bunx prisma db push --skip-generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
    console.log('Database schema synced.');
  } catch (err) {
    console.error('Failed to sync database schema:', err.message);
    console.log('⚠️  PostgreSQLが起動していることを確認してください。');
    process.exit(1);
  }

  console.log('Generating Prisma Client...');
  try {
    execSync('bun run db:generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to generate Prisma Client:', err.message);
    process.exit(1);
  }

  // バックエンドを起動
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

  backend.on('error', (err) => console.error('Backend error:', err));
  frontend.on('error', (err) => console.error('Frontend error:', err));
}

// プロセス終了時のクリーンアップ（プロセスツリーごと終了）
function cleanup() {
  console.log('\nStopping development servers...');
  killProcessTree(backend);
  killProcessTree(frontend);
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', () => {
  killProcessTree(backend);
  killProcessTree(frontend);
});

main().catch((err) => {
  console.error('Failed to start development servers:', err);
  process.exit(1);
});
