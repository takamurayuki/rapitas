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
const crypto = require('crypto');

// コマンドライン引数をパース
const args = process.argv.slice(2);
const useWatch = args.includes('--watch');

const FRONTEND_DIR = path.resolve(__dirname, '../../rapitas-frontend');
const BACKEND_DIR = path.resolve(__dirname, '../../rapitas-backend');
const BINARIES_DIR = path.resolve(__dirname, '../src-tauri/binaries');

if (useWatch) {
  console.log('Starting development servers for Tauri (SQLite mode) with HOT RELOAD...');
  console.log('⚠️  注意: ファイル変更時にバックエンドが再起動します。AIエージェント実行中は中断される可能性があります。');
} else {
  console.log('Starting development servers for Tauri (SQLite mode) in STABLE mode...');
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

// SQLiteデータベースのパスを設定
const appDataPath = process.env.APPDATA || process.env.HOME || '.';
const dbDir = path.join(appDataPath, 'rapitas');
const dbPath = path.join(dbDir, 'rapitas.db');
const schemaHashPath = path.join(dbDir, '.schema-hash');

// データベースディレクトリを作成
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
  console.log(`Created database directory: ${dbDir}`);
}

const sqliteDbUrl = `file:${dbPath}`;

// スキーマファイルのハッシュを計算
function getSchemaHash() {
  const schemaPath = path.join(BACKEND_DIR, 'prisma', 'schema.sqlite.prisma');
  if (!fs.existsSync(schemaPath)) return null;
  const content = fs.readFileSync(schemaPath, 'utf-8');
  return crypto.createHash('md5').update(content).digest('hex');
}

// スキーマが変更されたかチェック
function isSchemaChanged() {
  const currentHash = getSchemaHash();
  if (!currentHash) return true;

  if (!fs.existsSync(schemaHashPath)) return true;

  const savedHash = fs.readFileSync(schemaHashPath, 'utf-8').trim();
  return currentHash !== savedHash;
}

// スキーマハッシュを保存
function saveSchemaHash() {
  const hash = getSchemaHash();
  if (hash) {
    fs.writeFileSync(schemaHashPath, hash);
  }
}

// 常にSQLiteスキーマに切り替え（Web版からの切り替え対応）
console.log('Switching to SQLite schema...');
try {
  execSync('node scripts/switch-schema.cjs sqlite', { cwd: BACKEND_DIR, stdio: 'inherit' });
  execSync('bun run db:generate', { cwd: BACKEND_DIR, stdio: 'inherit' });
} catch (err) {
  console.error('Failed to switch to SQLite schema:', err.message);
  process.exit(1);
}

// データベースが存在し、スキーマが変更されていない場合はDB作成をスキップ
const dbExists = fs.existsSync(dbPath);
const schemaChanged = isSchemaChanged();

if (dbExists && !schemaChanged) {
  console.log('Database exists and schema unchanged, skipping DB creation...');
  console.log(`SQLite database path: ${dbPath}`);
} else {
  // 既存のバックエンドプロセスを停止（ファイルロック解除のため）
  console.log('Stopping existing backend processes for DB setup...');
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM bun.exe 2>nul', { shell: true, stdio: 'ignore' });
    } else {
      execSync('pkill -f "bun.*index.ts" || true', { shell: true, stdio: 'ignore' });
    }
    execSync(process.platform === 'win32' ? 'ping -n 2 127.0.0.1 >nul' : 'sleep 1', { shell: true, stdio: 'ignore' });
  } catch (err) {}

  console.log('Updating SQLite database schema...');
  console.log(`SQLite database path: ${dbPath}`);

  try {
    // prisma db push はデータを保持しながらスキーマを更新する
    // 破壊的な変更がある場合のみデータ損失が発生する可能性がある
    console.log('Pushing schema to SQLite database (preserving data)...');
    execSync('bunx prisma db push --skip-generate', {
      cwd: BACKEND_DIR,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: sqliteDbUrl
      }
    });

    // スキーマハッシュを保存
    saveSchemaHash();
    console.log('Database schema update complete!');
  } catch (err) {
    // prisma db push が失敗した場合（破壊的な変更など）
    console.error('Schema update failed:', err.message);
    console.log('\n⚠️  スキーマの更新に失敗しました。');
    console.log('破壊的な変更（カラム削除など）がある場合は、以下のコマンドでDBをリセットできます:');
    console.log(`  rm "${dbPath}"`);
    console.log('  その後、再度このスクリプトを実行してください。\n');
    process.exit(1);
  }
}

// バックエンドを起動 (SQLiteモード)
// --watch オプションに応じてホットリロードの有無を切り替え
const backendScript = useWatch ? 'dev:simple' : 'dev:stable';
console.log(`\nBackend mode: ${useWatch ? 'dev:simple (hot reload)' : 'dev:stable (stable)'}`);

const backend = spawn('bun', ['run', backendScript], {
  cwd: BACKEND_DIR,
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    TAURI_BUILD: 'true',
    RAPITAS_SQLITE: 'true',
    DATABASE_URL: sqliteDbUrl
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
