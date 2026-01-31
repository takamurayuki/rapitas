#!/usr/bin/env node
/**
 * バックエンドをスタンドアロン実行ファイルにビルドするスクリプト
 * SQLite対応版（Tauriビルド用）
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '../../rapitas-backend');
const PRISMA_DIR = path.join(BACKEND_DIR, 'prisma');
const OUTPUT_DIR = path.resolve(__dirname, '../src-tauri/binaries');

// プラットフォーム別の出力ファイル名
const platform = process.platform;
const arch = process.arch;

// Tauriが期待するバイナリ名のフォーマット: <sidecar-name>-<target-triple>
const targetTriple = getTargetTriple();
const outputName = `rapitas-backend-${targetTriple}${platform === 'win32' ? '.exe' : ''}`;

function getTargetTriple() {
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

try {
  // Step 1: SQLiteスキーマをメインスキーマとして使用
  console.log('\nStep 1: Setting up SQLite schema...');
  const postgresSchema = path.join(PRISMA_DIR, 'schema.prisma');
  const sqliteSchema = path.join(PRISMA_DIR, 'schema.sqlite.prisma');
  const backupSchema = path.join(PRISMA_DIR, 'schema.postgres.backup.prisma');

  // PostgreSQLスキーマをバックアップ
  if (fs.existsSync(postgresSchema) && !fs.existsSync(backupSchema)) {
    fs.copyFileSync(postgresSchema, backupSchema);
  }

  // SQLiteスキーマをメインスキーマとしてコピー
  if (fs.existsSync(sqliteSchema)) {
    fs.copyFileSync(sqliteSchema, postgresSchema);
    console.log('SQLite schema applied.');
  } else {
    console.error('SQLite schema not found!');
    process.exit(1);
  }

  // Step 2: Prisma Clientを生成
  console.log('\nStep 2: Generating Prisma Client for SQLite...');
  execSync('bun run prisma generate', {
    stdio: 'inherit',
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      DATABASE_URL: 'file:./rapitas.db'
    }
  });

  // Step 3: Bunでバックエンドをコンパイル
  console.log('\nStep 3: Compiling backend with Bun...');
  const outputPath = path.join(OUTPUT_DIR, outputName);

  execSync(
    `bun build ${path.join(BACKEND_DIR, 'index.ts')} --compile --outfile "${outputPath}"`,
    {
      stdio: 'inherit',
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        TAURI_BUILD: 'true',
        RAPITAS_SQLITE: 'true'
      }
    }
  );

  console.log('\nBackend build complete!');
  console.log(`Output: ${outputPath}`);

} catch (error) {
  console.error('Failed to build backend:', error.message);
  process.exit(1);
} finally {
  // Step 4: PostgreSQLスキーマを復元
  console.log('\nStep 4: Restoring PostgreSQL schema...');
  const postgresSchema = path.join(PRISMA_DIR, 'schema.prisma');
  const backupSchema = path.join(PRISMA_DIR, 'schema.postgres.backup.prisma');

  if (fs.existsSync(backupSchema)) {
    fs.copyFileSync(backupSchema, postgresSchema);
    fs.unlinkSync(backupSchema);
    console.log('PostgreSQL schema restored.');
  }

  // Prisma Clientを元に戻す（PostgreSQL用）
  try {
    execSync('bun run prisma generate', {
      stdio: 'inherit',
      cwd: BACKEND_DIR
    });
    console.log('Prisma Client restored for PostgreSQL.');
  } catch (e) {
    console.warn('Warning: Could not regenerate PostgreSQL Prisma Client');
  }
}
