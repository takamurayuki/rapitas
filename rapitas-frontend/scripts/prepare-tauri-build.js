#!/usr/bin/env node
/**
 * Tauri ビルド用のスクリプト
 * 静的エクスポート後にビルドキャッシュを除去し、SPA フォールバックを設定します。
 *
 * Next.js が output:'export' + distDir:'.next-tauri' で生成するファイル:
 *   .next-tauri/                ← Tauri の frontendDist
 *     _next/static/             ← KEEP: クライアント向け JS/CSS チャンク
 *     *.html                    ← KEEP: ページ HTML
 *     tasks/_placeholder/       ← DELETE: プレースホルダー（実行時不要）
 *     cache/                    ← DELETE: webpack/SWC ビルドキャッシュ（数百 MB）
 *     server/                   ← DELETE: サーバーサイドバンドル（export では不要）
 *     trace                     ← DELETE: ビルドトレースファイル
 */
const fs = require('fs');
const path = require('path');

// Next.js が distDir:'.next-tauri' + output:'export' で出力するディレクトリ
const OUTPUT_DIR = '.next-tauri';

// SPAフォールバックが必要な動的ルート（プレースホルダー削除のみ行う）
const DYNAMIC_ROUTES = [
  { path: 'approvals', placeholder: '_placeholder' },
  { path: 'tasks', placeholder: '_placeholder' },
  { path: 'github/pull-requests', placeholder: '_placeholder' },
];

// ビルドに不要なディレクトリ・ファイル（Tauri バンドルから除外するため削除）
const BUILD_ARTIFACTS_TO_REMOVE = [
  'cache',    // webpack/SWC ビルドキャッシュ（数百 MB になることがある）
  'server',   // サーバーサイドバンドル（静的エクスポートでは使用しない）
  'trace',    // Next.js ビルドトレース（デバッグ用、リリース不要）
];

const action = process.argv[2];

if (action === 'backup') {
  // 何もしない（互換性のため残す）
  console.log('Preparing for Tauri build...');
  console.log('Dynamic routes will be handled via SPA fallback (404.html).');
} else if (action === 'restore') {
  console.log('Post-build cleanup for Tauri bundle...');

  // 1. ビルドキャッシュを削除してバンドルサイズを削減
  console.log('\nStep 1: Removing build artifacts from bundle...');
  for (const artifact of BUILD_ARTIFACTS_TO_REMOVE) {
    const artifactPath = path.join(OUTPUT_DIR, artifact);
    if (fs.existsSync(artifactPath)) {
      const stat = fs.statSync(artifactPath);
      if (stat.isDirectory()) {
        fs.rmSync(artifactPath, { recursive: true });
      } else {
        fs.rmSync(artifactPath);
      }
      console.log(`  Removed: ${artifact}`);
    }
  }

  // 2. 動的ルートのプレースホルダーを削除
  //    デスクトップ SPA では Next.js のクライアントサイドルーターが全ナビゲーションを
  //    処理するため、ID 別の HTML ファイルは不要。
  console.log('\nStep 2: Cleaning up dynamic route placeholders...');
  for (const route of DYNAMIC_ROUTES) {
    const placeholderDir = path.join(OUTPUT_DIR, route.path, route.placeholder);
    if (fs.existsSync(placeholderDir)) {
      fs.rmSync(placeholderDir, { recursive: true });
      console.log(`  Removed placeholder: /${route.path}/${route.placeholder}/`);
    }
  }

  // 3. 404.html を作成（SPA フォールバック）
  //    Tauri が未知のパスを要求された場合に index.html の内容を返す。
  console.log('\nStep 3: Creating SPA fallback (404.html)...');
  const indexHtmlPath = path.join(OUTPUT_DIR, 'index.html');
  const notFoundPath = path.join(OUTPUT_DIR, '404.html');
  if (fs.existsSync(indexHtmlPath) && !fs.existsSync(notFoundPath)) {
    fs.copyFileSync(indexHtmlPath, notFoundPath);
    console.log('  Created 404.html for SPA fallback.');
  } else if (fs.existsSync(notFoundPath)) {
    console.log('  404.html already exists, skipping.');
  } else {
    console.log('  Warning: index.html not found, skipping 404.html creation.');
  }

  console.log('\nTauri bundle cleanup complete.');
} else {
  console.log('Usage: node prepare-tauri-build.js [backup|restore]');
  process.exit(1);
}
