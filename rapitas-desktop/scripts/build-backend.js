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

console.log('Building backend for Tauri sidecar (PostgreSQL)...');
console.log(`Platform: ${platform}, Arch: ${arch}`);
console.log(`Target triple: ${targetTriple}`);
console.log(`Output: ${outputName}`);

// 出力ディレクトリを作成
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

try {
  // Step 1: Prisma Clientを生成
  console.log('\nStep 1: Generating Prisma Client...');
  execSync('bun run prisma generate', {
    stdio: 'inherit',
    cwd: BACKEND_DIR
  });

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
