'use client';

import { useEffect } from 'react';
import { warmupApplicationCache } from '@/lib/cache-warmup';

/**
 * CacheWarmupInitializer
 *
 * Triggers application cache warmup on mount.
 */
export default function CacheWarmupInitializer() {
  useEffect(() => {
    // NOTE: Delayed to let UI initialization complete first
    const timer = setTimeout(() => {
      warmupApplicationCache();
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  return null;
}
