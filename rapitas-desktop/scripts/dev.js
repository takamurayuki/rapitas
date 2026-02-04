#!/usr/bin/env node
/**
 * 開発モード用スクリプト
 * フロントエンドとバックエンドを並行して起動
 * 開発時はNext.js開発サーバー(localhost:3000)のホットリロードを使用
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

// コマンドライン引数をパース
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

// 開発モード用にダミーの.next-tauriディレクトリを作成（Tauriがパスを検証するため）
// 実際の開発ではdevUrl (localhost:3000) を使用するが、TauriはfrontendDistの存在を確認する
const NEXT_TAURI_DIR = path.join(FRONTEND_DIR, '.next-tauri');
if (!fs.existsSync(NEXT_TAURI_DIR)) {
  console.log('Creating dummy .next-tauri directory for development...');
  fs.mkdirSync(NEXT_TAURI_DIR, { recursive: true });
  // Tauriがindex.htmlの存在も確認する場合に備えてダミーファイルを作成
  fs.writeFileSync(path.join(NEXT_TAURI_DIR, 'index.html'), '<!-- Dummy file for Tauri dev mode -->');
  console.log(`Created: ${NEXT_TAURI_DIR}`);
}

// データベーススキーマを同期してPrisma Clientを生成
console.log('Syncing database schema...');
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

// バックエンドを起動 (PostgreSQLモード)
// --watch オプションに応じてホットリロードの有無を切り替え
const backendScript = useWatch ? 'dev:simple' : 'dev:stable';
console.log(`\nBackend mode: ${useWatch ? 'dev:simple (hot reload)' : 'dev:stable (stable)'}`);

const backend = spawn('bun', ['run', backendScript], {
  cwd: BACKEND_DIR,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    TAURI_BUILD: 'true'
  }
});

// フロントエンドを起動
const frontend = spawn('pnpm', ['run', 'dev'], {
  cwd: FRONTEND_DIR,
  stdio: 'inherit',
  shell: true
});

// 開発モードではNext.js開発サーバー(localhost:3000)を使用
// .next-tauriは本番ビルド時のみ使用されるため、ここではビルドしない
console.log('\n🖥️  Development mode: using Next.js dev server at http://localhost:3000');
console.log('ℹ️  Changes will be reflected via hot reload (no rebuild needed)');

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\nStopping development servers...');
  backend.kill();
  frontend.kill();
  process.exit();
});

process.on('SIGTERM', () => {
  backend.kill();
  frontend.kill();
  process.exit();
});

// 子プロセスのエラーハンドリング
backend.on('error', (err) => {
  console.error('Backend error:', err);
});

frontend.on('error', (err) => {
  console.error('Frontend error:', err);
});
