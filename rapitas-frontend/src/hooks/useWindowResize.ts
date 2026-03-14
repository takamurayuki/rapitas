'use client';

import { useEffect, useCallback, useRef } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useWindowResize');

interface UseWindowResizeOptions {
  debounceMs?: number;
  onResize?: () => void;
  onResizeStart?: () => void;
  onResizeEnd?: () => void;
}

export function useWindowResize({
  debounceMs = 150,
  onResize,
  onResizeStart,
  onResizeEnd,
}: UseWindowResizeOptions = {}) {
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isResizingRef = useRef(false);

  const handleResize = useCallback(() => {
    // Handle resize start
    if (!isResizingRef.current) {
      isResizingRef.current = true;
      document.documentElement.classList.add('window-resizing');
      onResizeStart?.();
    }

    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    // Handle resize in progress
    onResize?.();

    // Debounce
    resizeTimeoutRef.current = setTimeout(() => {
      isResizingRef.current = false;
      document.documentElement.classList.remove('window-resizing');
      onResizeEnd?.();
    }, debounceMs);
  }, [debounceMs, onResize, onResizeStart, onResizeEnd]);

  useEffect(() => {
    // Check for Tauri environment
    const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

    if (isTauri && window.__TAURI__?.event) {
      // Receive optimized resize events from Tauri
      const { listen } = window.__TAURI__.event;

      let unlisten: (() => void) | undefined;

      (async () => {
        unlisten = await listen('window-resize-optimized', handleResize);
      })();

      // NOTE: Skip standard resize events when Tauri events are available (prevents double-firing)

      return () => {
        unlisten?.();
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    } else {
      // Standard web browser environment
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    }
  }, [handleResize]);
}

// Hook for performance monitoring
export function useResizePerformance() {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    // Initialize timing on mount
    lastTimeRef.current = performance.now();
    let animationFrameId: number;

    const measureFPS = () => {
      frameCountRef.current++;
      const currentTime = performance.now();
      const deltaTime = currentTime - lastTimeRef.current;

      if (deltaTime >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / deltaTime);
        if (fps < 30) {
          logger.warn(`Low FPS detected during resize: ${fps}`);
        }
        frameCountRef.current = 0;
        lastTimeRef.current = currentTime;
      }

      animationFrameId = requestAnimationFrame(measureFPS);
    };

    // Only enable FPS measurement in development
    if (process.env.NODE_ENV === 'development') {
      measureFPS();
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, []);
}
