/**
 * skeleton-blocks
 *
 * Primitive skeleton block components used as building blocks for all skeleton loaders.
 * Not responsible for any page-level layout or specific skeleton patterns.
 */

import React from 'react';

/**
 * Basic skeleton block with a pulse animation.
 *
 * @param className - Additional Tailwind classes for sizing and shape / サイズ・形状のTailwindクラス
 */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-zinc-200 dark:bg-zinc-700 rounded animate-pulse ${className}`}
    />
  );
}

/**
 * Enhanced skeleton block with a shimmer wave animation layered over the pulse.
 *
 * @param className - Additional Tailwind classes / 追加Tailwindクラス
 * @param delay - Animation delay in milliseconds for staggered effects / スタガーアニメーション用のディレイ(ms)
 * @param shimmer - Whether to render the shimmer overlay / シマーオーバーレイを表示するか
 * @param style - Inline styles forwarded to the root element / ルート要素に渡すインラインスタイル
 */
export function EnhancedSkeletonBlock({
  className = '',
  delay = 0,
  shimmer = true,
  style,
}: {
  className?: string;
  delay?: number;
  shimmer?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-zinc-200 dark:bg-zinc-700 rounded ${className}`}
      style={{ animationDelay: `${delay}ms`, ...style }}
    >
      {shimmer && (
        <div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 dark:via-zinc-500/10 to-transparent animate-[shimmer_2s_infinite] rounded" />
      )}
      <div className="w-full h-full bg-zinc-200 dark:bg-zinc-700 animate-pulse rounded" />
    </div>
  );
}
