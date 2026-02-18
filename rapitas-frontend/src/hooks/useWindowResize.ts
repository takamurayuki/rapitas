'use client';

import { useEffect, useCallback, useRef } from 'react';

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
    // リサイズ開始時の処理
    if (!isResizingRef.current) {
      isResizingRef.current = true;
      document.documentElement.classList.add('window-resizing');
      onResizeStart?.();
    }

    // 既存のタイマーをクリア
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    // リサイズ中の処理
    onResize?.();

    // デバウンス処理
    resizeTimeoutRef.current = setTimeout(() => {
      isResizingRef.current = false;
      document.documentElement.classList.remove('window-resizing');
      onResizeEnd?.();
    }, debounceMs);
  }, [debounceMs, onResize, onResizeStart, onResizeEnd]);

  useEffect(() => {
    // Tauri環境かチェック
    const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

    if (isTauri) {
      // Tauriからの最適化されたリサイズイベントを受信
      const { listen } = window.__TAURI__.event;

      let unlisten: (() => void) | undefined;

      (async () => {
        unlisten = await listen('window-resize-optimized', handleResize);
      })();

      // Tauriイベントがある場合は、通常のリサイズイベントは登録しない（二重実行を防ぐ）

      return () => {
        unlisten?.();
        if (resizeTimeoutRef.current) {
          clearTimeout(resizeTimeoutRef.current);
        }
      };
    } else {
      // 通常のWebブラウザ環境
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

// パフォーマンス監視用のフック
export function useResizePerformance() {
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());

  useEffect(() => {
    let animationFrameId: number;

    const measureFPS = () => {
      frameCountRef.current++;
      const currentTime = performance.now();
      const deltaTime = currentTime - lastTimeRef.current;

      if (deltaTime >= 1000) {
        const fps = Math.round((frameCountRef.current * 1000) / deltaTime);
        if (fps < 30) {
          console.warn(`Low FPS detected during resize: ${fps}`);
        }
        frameCountRef.current = 0;
        lastTimeRef.current = currentTime;
      }

      animationFrameId = requestAnimationFrame(measureFPS);
    };

    // 開発環境でのみFPS計測を有効化
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