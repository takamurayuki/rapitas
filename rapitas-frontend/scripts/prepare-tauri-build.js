#!/usr/bin/env node
/**
 * Tauri ビルド用のスクリプト
 * 静的エクスポート後にSPAフォールバックを設定します
 */
const fs = require('fs');
const path = require('path');

// Next.js 14以降、静的エクスポートは常に'out'ディレクトリに出力される
const OUTPUT_DIR = 'out';

// SPAフォールバックが必要な動的ルート
const DYNAMIC_ROUTES = [
  { path: 'approvals', placeholder: '_placeholder' },
  { path: 'tasks', placeholder: '_placeholder' },
  { path: 'github/pull-requests', placeholder: '_placeholder' },
];

// 生成するプレースホルダーIDの数（1-MAX_IDS）
const MAX_IDS = 1000;

const action = process.argv[2];

if (action === 'backup') {
  // 何もしない（互換性のため残す）
  console.log('Preparing for Tauri build...');
  console.log('Dynamic routes will be handled via SPA fallback.');
} else if (action === 'restore') {
  // ビルド後にSPAフォールバックを設定
  console.log('Setting up SPA fallback for dynamic routes...');

  for (const route of DYNAMIC_ROUTES) {
    const placeholderDir = path.join(OUTPUT_DIR, route.path, route.placeholder);
    const placeholderHtml = path.join(placeholderDir, 'index.html');

    if (!fs.existsSync(placeholderHtml)) {
      console.log(
        `  Warning: ${placeholderHtml} not found, skipping ${route.path}`,
      );
      continue;
    }

    // プレースホルダーのHTMLを読み取る
    const html = fs.readFileSync(placeholderHtml, 'utf8');

    // 数字IDのディレクトリを作成
    for (let i = 1; i <= MAX_IDS; i++) {
      const idDir = path.join(OUTPUT_DIR, route.path, String(i));
      if (!fs.existsSync(idDir)) {
        fs.mkdirSync(idDir, { recursive: true });
      }
      fs.writeFileSync(path.join(idDir, 'index.html'), html);
    }

    console.log(`  Created ${MAX_IDS} fallback pages for /${route.path}/[id]`);

    // プレースホルダーディレクトリを削除
    fs.rmSync(placeholderDir, { recursive: true });
  }

  // 404.htmlも作成（Tauriフォールバック用）
  const indexHtmlPath = path.join(OUTPUT_DIR, 'index.html');
  const notFoundPath = path.join(OUTPUT_DIR, '404.html');
  if (fs.existsSync(indexHtmlPath) && !fs.existsSync(notFoundPath)) {
    fs.copyFileSync(indexHtmlPath, notFoundPath);
    console.log('  Created 404.html for SPA fallback');
  }

  console.log('SPA fallback setup complete.');
} else {
  console.log('Usage: node prepare-tauri-build.js [backup|restore]');
  process.exit(1);
}
