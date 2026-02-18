#!/usr/bin/env node
/**
 * CI環境用のバックエンドビルドスクリプト
 * 実際のビルドはスキップし、プレースホルダーのバイナリを作成
 */
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '../src-tauri/binaries');

// プラットフォーム別の出力ファイル名
const platform = process.platform;
const arch = process.arch;

// Tauriが期待するバイナリ名のフォーマット: <sidecar-name>-<target-triple>
const targetTriple = getTargetTriple();
const outputName = `rapitas-backend-${targetTriple}${platform === 'win32' ? '.exe' : ''}`;

function getTargetTriple() {
  // GitHub ActionsのTARGET環境変数を優先
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

console.log('Creating placeholder backend binary for CI...');
console.log(`Platform: ${platform}, Arch: ${arch}`);
console.log(`Target triple: ${targetTriple}`);
console.log(`Output: ${outputName}`);

// 出力ディレクトリを作成
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

try {
  const outputPath = path.join(OUTPUT_DIR, outputName);

  // CI環境ではプレースホルダーファイルを作成
  // これによりTauriのビルドが成功する
  const placeholderContent = Buffer.from('CI Build Placeholder - Replace with actual backend binary', 'utf8');
  fs.writeFileSync(outputPath, placeholderContent);

  // 実行権限を付与（Unix系システムの場合）
  if (platform !== 'win32') {
    fs.chmodSync(outputPath, 0o755);
  }

  console.log('\nCI placeholder binary created!');
  console.log(`Output: ${outputPath}`);

} catch (error) {
  console.error('Failed to create CI placeholder:', error.message);
  process.exit(1);
}