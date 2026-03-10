'use client';

import { useEffect } from 'react';
import { warmupApplicationCache } from '@/lib/cache-warmup';

/**
 * アプリケーション起動時のキャッシュウォームアップを実行
 */
export default function CacheWarmupInitializer() {
  useEffect(() => {
    // 初回レンダリング後にキャッシュウォームアップを実行
    const timer = setTimeout(() => {
      warmupApplicationCache();
    }, 500); // UIの初期化を優先し、少し遅延してから実行

    return () => clearTimeout(timer);
  }, []);

  // このコンポーネントは何も表示しない
  return null;
}
