/**
 * EmptyState
 *
 * Shared "zero items" placeholder: icon + title + optional description + optional
 * action button, on the neutral zinc palette. Not responsible for loading states
 * (see `Spinner`/skeletons) or error states (see `alert.tsx`).
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** Props for EmptyState. */
export interface EmptyStateProps {
  /** Lucide icon component rendered above the title / タイトル上に表示するアイコン */
  icon: LucideIcon;
  /** Primary message, e.g. "タスクがありません" / 主要メッセージ */
  title: string;
  /** Optional supporting copy, ideally the next concrete action / 補足説明（次に取るべき行動が望ましい） */
  description?: string;
  /** Optional call-to-action rendered below the description / 説明の下に表示するCTA */
  action?: React.ReactNode;
  /** Additional classes for the outer container / 外側コンテナへの追加クラス */
  className?: string;
}

/**
 * Renders a centered empty-state block: icon, title, optional description, optional action.
 *
 * @param icon - Lucide icon component / アイコン
 * @param title - Primary message / 主要メッセージ
 * @param description - Optional supporting copy / 補足説明
 * @param action - Optional CTA node (e.g. a button) / 任意のCTA
 * @param className - Additional classes for the outer container / 追加クラス
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div className={`text-center py-12 ${className}`}>
      <Icon className="w-12 h-12 mx-auto mb-4 text-zinc-300 dark:text-zinc-700" />
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{title}</p>
      {description && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
