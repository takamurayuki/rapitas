#!/usr/bin/env node
/**
 * バックエンドをスタンドアロン実行ファイルにビルドするスクリプト
 * SQLite対応版（Tauriビルド用）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../../rapitas-backend');
const OUTPUT_DIR = path.resolve(__dirname, '../src-tauri/binaries');

// プラットフォーム別の出力ファイル名
const platform = process.platform;
const arch = process.arch;

// Tauriが期待するバイナリ名のフォーマット: Windows では <sidecar-name>.exe-<target-triple>.exe
const targetTriple = getTargetTriple();
const outputName = platform === 'win32'
  ? `rapitas-backend.exe-${targetTriple}.exe`
  : `rapitas-backend-${targetTriple}`;

function getTargetTriple() {
  // GitHub ActionsのTARGET環境変数を優先（CI環境用）
  if (process.env.TARGET) {
    return process.env.TARGET;
  }

  const platformMap = {
    'win32': 'x86_64-pc-windows-msvc',
    'darwin': arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
    'linux': 'x86_64-unknown-linux-gnu'
  };
  return platformMap[platform] || 'x86_64-unknown-linux-gnu';
}

console.log('Building backend for Tauri sidecar (SQLite)...');
console.log(`Platform: ${platform}, Arch: ${arch}`);
console.log(`Target triple: ${targetTriple}`);
console.log(`Output: ${outputName}`);

// 出力ディレクトリを作成
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// CI環境の検出
const isCI = process.env.CI === 'true';

try {
  // Step 1: Desktop向けSQLite Prisma Clientと初期化SQLを生成
  if (!isCI) {
    console.log('\nStep 1: Generating SQLite Prisma Client and init SQL...');
    execSync('bun run db:prepare:sqlite', {
      stdio: 'inherit',
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        RAPITAS_DB_PROVIDER: 'sqlite',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./rapitas-desktop.db'
      }
    });
  } else {
    console.log('\nStep 1: Skipping Prisma Client generation in CI...');
  }

  // Step 2: Bunでバックエンドをコンパイル
  console.log('\nStep 2: Compiling backend with Bun...');
  const outputPath = path.join(OUTPUT_DIR, outputName);

  execSync(
    `bun build ${path.join(BACKEND_DIR, 'index.ts')} --compile --outfile "${outputPath}"`,
    {
      stdio: 'inherit',
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        TAURI_BUILD: 'true',
        RAPITAS_DB_PROVIDER: 'sqlite',
        DATABASE_URL: process.env.DATABASE_URL || 'file:./rapitas-desktop.db'
      }
    }
  );

  console.log('\nBackend build complete!');
  console.log(`Output: ${outputPath}`);

  // Step 3: Prisma のネイティブクエリエンジンを同梱する。
  // bun build --compile は .node ネイティブライブラリを単一バイナリへ含められず、
  // ユーザー環境には node_modules も無いため、エンジン無し配布は起動時に
  // PrismaClientInitializationError で即死する（インストーラ版が全滅した原因）。
  // release.rs が exe と一緒に app data へコピーし PRISMA_QUERY_ENGINE_LIBRARY で
  // 明示パスを渡す。
  console.log('\nStep 3: Bundling Prisma query engine...');
  const prismaClientDir = path.join(BACKEND_DIR, 'node_modules', '.prisma', 'client');
  const engineFiles = fs.existsSync(prismaClientDir)
    ? fs.readdirSync(prismaClientDir).filter(
        (f) => f.includes('query_engine') && f.endsWith('.node') && !f.includes('.tmp')
      )
    : [];
  if (engineFiles.length === 0) {
    console.error(
      'No Prisma query engine found in node_modules/.prisma/client — ' +
      'the packaged backend would crash on startup. Run db:prepare:sqlite first.'
    );
    process.exit(1);
  }
  for (const engine of engineFiles) {
    fs.copyFileSync(path.join(prismaClientDir, engine), path.join(OUTPUT_DIR, engine));
    console.log(`Bundled engine: ${engine}`);
  }

} catch (error) {
  console.error('Failed to build backend:', error.message);
  process.exit(1);
}
