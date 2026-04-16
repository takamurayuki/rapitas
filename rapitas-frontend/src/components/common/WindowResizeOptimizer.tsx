'use client';
// WindowResizeOptimizer

import {
  useWindowResize,
  useResizePerformance,
} from '@/hooks/ui/useWindowResize';
import { useEffect } from 'react';

export default function WindowResizeOptimizer() {
  useResizePerformance();

  useWindowResize({
    debounceMs: 150,
    onResizeStart: () => {
      document.documentElement.classList.add('window-resizing');

      const nonTaskElements = document.querySelectorAll(
        'body > *:not([data-task-card-container])',
      );
      nonTaskElements.forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.pointerEvents = 'none';
        }
      });

      const animatedElements = document.querySelectorAll(
        '[class*="animate-"]:not(.group):not([data-task-card]):not([class*="task"]):not([class*="card"])',
      );
      animatedElements.forEach((el) => {
        el.classList.add('resize-pause');
      });

      // NOTE: Marks slide-in animations as completed so they don't re-trigger after resize.
      const slideInElements = document.querySelectorAll(
        '.slide-in-bottom:not([data-task-card])',
      );
      slideInElements.forEach((el) => {
        el.classList.add('animation-done');
      });

      const infiniteAnimations = document.querySelectorAll(
        '[class*="infinite"]:not([data-task-card])',
      );
      infiniteAnimations.forEach((el) => {
        el.classList.add('resize-pause');
      });
    },
    onResizeEnd: () => {
      document.documentElement.classList.remove('window-resizing');

      const nonTaskElements = document.querySelectorAll(
        'body > *:not([data-task-card-container])',
      );
      nonTaskElements.forEach((el) => {
        if (el instanceof HTMLElement) {
          el.style.pointerEvents = '';
        }
      });

      // NOTE: Small delay ensures the browser completes its layout pass before resuming animations.
      setTimeout(() => {
        const animatedElements = document.querySelectorAll('.resize-pause');
        animatedElements.forEach((el) => {
          el.classList.remove('resize-pause');
        });
      }, 50);

      window.dispatchEvent(new Event('resize-complete'));
    },
  });

  useEffect(() => {
    const animationTimer = setTimeout(() => {
      document.documentElement.classList.add('animations-executed');
    }, 1000);

    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.classList.add('main-container', 'layout-stable');
    }

    const scrollableElements = document.querySelectorAll(
      '.overflow-auto, .overflow-y-auto, .overflow-x-auto',
    );
    scrollableElements.forEach((el) => {
      el.classList.add('scroll-optimized');
    });

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
