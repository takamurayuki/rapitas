#!/usr/bin/env node
/**
 * バックエンドをスタンドアロン実行ファイルにビルドするスクリプト
 * PostgreSQL対応版（Tauriビルド用）
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

console.log('Building backend for Tauri sidecar (PostgreSQL)...');
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
  // Step 1: Prisma Clientを生成
  if (!isCI) {
    console.log('\nStep 1: Generating Prisma Client...');
    execSync('bun run prisma generate', {
      stdio: 'inherit',
      cwd: BACKEND_DIR
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
        TAURI_BUILD: 'true'
      }
    }
  );

  console.log('\nBackend build complete!');
  console.log(`Output: ${outputPath}`);

} catch (error) {
  console.error('Failed to build backend:', error.message);
  process.exit(1);
}
