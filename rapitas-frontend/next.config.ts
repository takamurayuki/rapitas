import type { NextConfig } from 'next';
import path from 'path';

const isTauriBuild = process.env.TAURI_BUILD === 'true';
const disableTurbopack = process.env.NEXT_TURBO === '0';
const isCI = process.env.CI === 'true';

// NOTE: この config に webpack キー(splitChunks 等)を追加しないこと。Next 16 の Turbopack ビルドは
// 「webpack 設定あり・turbopack 設定なし」を validateTurboNextConfig が検出すると process.exit(1) で
// 強制失敗する(task #553 で実測)。バンドル予算は scripts/check-bundle-size.cjs の eager 限定判定で担保する。
const nextConfig: NextConfig = {
  // ビルド出力ディレクトリを環境で分離
  // CI環境では標準の.nextを使用（静的エクスポートは常にoutディレクトリに出力される）
  distDir: !isCI && isTauriBuild ? '.next-tauri' : '.next',

  // Turbopackのルートディレクトリをモノレポルートに設定（警告抑制）
  // CI環境でTurbopackが無効化されている場合はこの設定をスキップ
  ...(disableTurbopack
    ? {}
    : {
        turbopack: {
          root: path.resolve(__dirname, '..'),
        },
      }),

  // Tauri用の静的エクスポート設定
  ...(isTauriBuild && {
    output: 'export',
    // 静的エクスポート時はImage Optimizationを無効化
    images: {
      unoptimized: true,
    },
  }),
};

export default nextConfig;
