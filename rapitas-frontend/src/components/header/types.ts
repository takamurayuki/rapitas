/**
 * header/types.ts
 *
 * Shared types, constants, and pure utilities used across the Header sub-components.
 * Does not contain any React component or hook logic.
 */

import type { CSSProperties } from 'react';

/** A single navigation item that may optionally have nested children. */
export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  children?: NavItem[];
  /** When set, the item is only shown in the corresponding app mode. */
  mode?: 'development' | 'learning';
};

type LineStyleVars = {
  '--line-duration': string;
  '--line-stagger': string;
  '--line-delay'?: string;
};

/** CSSProperties extended with CSS custom properties for line-draw animations. */
export type LineStyle = CSSProperties & LineStyleVars;

export const LINE_ANIMATION_DURATION = 0.22;
export const LINE_STAGGER = 0.12;
export const LINE_DELAY_STEP = 0.08;

const baseLineAnimationStyle: LineStyle = {
  '--line-duration': `${LINE_ANIMATION_DURATION}s`,
  '--line-stagger': `${LINE_STAGGER}s`,
};

/**
 * Builds a LineStyle with the given animation delay.
 *
 * @param delay - CSS time string (e.g. "0.08s") / CSSアニメーション遅延文字列
 * @returns LineStyle with delay merged in / 遅延を含むLineStyle
 */
export const lineStyle = (delay: string): LineStyle => ({
  ...baseLineAnimationStyle,
  '--line-delay': delay,
});

/**
 * Calculates an animation delay string for a nav connector line.
 *
 * @param depth - Nesting depth of the item / ネストの深さ
 * @param order - Sibling order index / 兄弟インデックス
 * @returns CSS time string / CSS時間文字列
 */
export const getLineDelay = (depth: number, order: number): string =>
  `${((depth + order) * LINE_DELAY_STEP).toFixed(3)}s`;

/**
 * Returns true when the given path looks like a task-detail page.
 *
 * @param path - URL pathname to test / テスト対象URLパス名
 * @returns whether the path is a task detail page / タスク詳細ページかどうか
 */
export const checkIsTaskDetailPage = (path: string | null): boolean => {
  if (!path) return false;
  return (
    (!!path.match(/^\/tasks\/[^/]+$/) && !path.endsWith('/new')) ||
    path.startsWith('/task-detail') ||
    path.startsWith('/tasks/detail')
  );
};
