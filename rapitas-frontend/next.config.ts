import type { NextConfig } from "next";
import path from "path";

const isTauriBuild = process.env.TAURI_BUILD === 'true';

const nextConfig: NextConfig = {
  // ビルド出力ディレクトリを環境で分離
  distDir: isTauriBuild ? '.next-tauri' : '.next',

  // Turbopackのルートディレクトリをモノレポルートに設定（警告抑制）
  turbopack: {
    root: path.resolve(__dirname, '..'),
  },

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
