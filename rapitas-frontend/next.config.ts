import type { NextConfig } from "next";

const isTauriBuild = process.env.TAURI_BUILD === 'true';

const nextConfig: NextConfig = {
  // ビルド出力ディレクトリを環境で分離
  distDir: isTauriBuild ? '.next-tauri' : '.next',

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
