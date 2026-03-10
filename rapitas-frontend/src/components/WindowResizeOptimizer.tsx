'use client';

import { useWindowResize, useResizePerformance } from '@/hooks/useWindowResize';
import { useEffect } from 'react';

export default function WindowResizeOptimizer() {
  // FPS計測（開発環境のみ）
  useResizePerformance();

  // ウィンドウリサイズの最適化
  useWindowResize({
    debounceMs: 150,
    onResizeStart: () => {
      // リサイズ開始時：タスクカード以外のポインターイベントを一時停止
      document.documentElement.classList.add('window-resizing');

      // タスクカード以外の要素のポインターイベントを無効化
      const nonTaskElements = document.querySelectorAll(
        'body > *:not([data-task-card-container])',
      );
      nonTaskElements.forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.pointerEvents = 'none';
        }
      });

      // 特定のアニメーション要素のみを無効化（タスクカードは除外）
      const animatedElements = document.querySelectorAll(
        '[class*="animate-"]:not(.group):not([data-task-card]):not([class*="task"]):not([class*="card"])',
      );
      animatedElements.forEach((el) => {
        el.classList.add('resize-pause');
      });

      // slide-in-bottomアニメーションを完了済みとしてマーク
      const slideInElements = document.querySelectorAll(
        '.slide-in-bottom:not([data-task-card])',
      );
      slideInElements.forEach((el) => {
        el.classList.add('animation-done');
      });

      // 無限ループアニメーション（タスクカード以外）は一時停止
      const infiniteAnimations = document.querySelectorAll(
        '[class*="infinite"]:not([data-task-card])',
      );
      infiniteAnimations.forEach((el) => {
        el.classList.add('resize-pause');
      });
    },
    onResizeEnd: () => {
      // リサイズ終了時：処理を再開
      document.documentElement.classList.remove('window-resizing');

      // 無効化したポインターイベントを復元
      const nonTaskElements = document.querySelectorAll(
        'body > *:not([data-task-card-container])',
      );
      nonTaskElements.forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.pointerEvents = '';
        }
      });

      // アニメーションを再有効化（段階的に）
      setTimeout(() => {
        const animatedElements = document.querySelectorAll('.resize-pause');
        animatedElements.forEach((el) => {
          el.classList.remove('resize-pause');
        });
      }, 50); // 少し遅延を入れて滑らかに復帰

      // レイアウトの再計算を強制
      window.dispatchEvent(new Event('resize-complete'));
    },
  });

  useEffect(() => {
    // 初回アニメーション実行後にフラグを設定
    const animationTimer = setTimeout(() => {
      document.documentElement.classList.add('animations-executed');
    }, 1000);

    // 主要なコンテナに最適化クラスを追加
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.classList.add('main-container', 'layout-stable');
    }

    // スクロール可能な要素に最適化クラスを追加
    const scrollableElements = document.querySelectorAll(
      '.overflow-auto, .overflow-y-auto, .overflow-x-auto',
    );
    scrollableElements.forEach((el) => {
      el.classList.add('scroll-optimized');
    });

    // グリッドレイアウトに最適化クラスを追加
    const gridElements = document.querySelectorAll(
      '[class*="grid "], [class*=" grid"]',
    );
    gridElements.forEach((el) => {
      el.classList.add('grid-optimized');
    });

    return () => clearTimeout(animationTimer);
  }, []);

  return null;
}
