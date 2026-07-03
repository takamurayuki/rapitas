/**
 * Spinner
 *
 * Shared inline loading indicator: wraps lucide `Loader2` (radially symmetric,
 * so it never warps mid-spin — see docs/design/ui-design-language.md §9) with
 * standard sizes and an accessible status role. Not responsible for full-page/
 * skeleton loaders (see `components/ui/skeleton/`).
 */
import React from 'react';
import { Loader2 } from 'lucide-react';

/** Spinner size variants, in ascending order. */
export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeStyles: Record<SpinnerSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-8 h-8',
  xl: 'w-12 h-12',
};

/** Props for Spinner. */
export interface SpinnerProps {
  /** Size variant / サイズバリアント */
  size?: SpinnerSize;
  /** Additional classes, e.g. color overrides / 追加クラス（色の上書きなど） */
  className?: string;
  /** Accessible label announced to screen readers / スクリーンリーダー向けラベル */
  label?: string;
}

/**
 * Renders an accessible, radially-symmetric loading spinner.
 *
 * @param size - Size variant / サイズバリアント
 * @param className - Additional classes for the icon / アイコンへの追加クラス
 * @param label - Screen-reader label / スクリーンリーダー用ラベル
 */
export function Spinner({ size = 'md', className = '', label = 'Loading...' }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center justify-center">
      <Loader2
        className={`${sizeStyles[size]} animate-spin text-zinc-400 dark:text-zinc-500 ${className}`}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
