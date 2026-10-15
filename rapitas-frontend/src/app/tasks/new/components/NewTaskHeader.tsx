'use client';
// NewTaskHeader
import { ArrowLeft, LayoutTemplate, ListPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { TaskTemplate } from '@/types';

interface NewTaskHeaderProps {
  /** Whether the form is currently submitting. */
  isSubmitting: boolean;
  /** Whether a valid title has been entered. */
  hasTitle: boolean;
  /** The template that was applied, or null if none. */
  appliedTemplate: TaskTemplate | null;
  /** Called when the user clicks the template button. */
  onOpenTemplate: () => void;
  /** Reverts the applied template (fields it filled reset to defaults). */
  onClearTemplate: () => void;
  /** Called when the user clicks the Create button. */
  onSubmit: (e?: React.FormEvent) => void;
}

/**
 * Renders the back/template/create button bar above the form.
 *
 * @param props.isSubmitting - Disables Create button while pending / 送信中はCreateボタンを無効化
 * @param props.hasTitle - Gates the Create button / タイトルがない場合Createボタンを無効化
 * @param props.appliedTemplate - Highlights template button when set / テンプレート適用済みの場合ハイライト
 * @param props.onOpenTemplate - Template dialog opener / テンプレートダイアログを開く
 * @param props.onSubmit - Form submit handler / フォーム送信ハンドラ
 */
export function NewTaskHeader({
  isSubmitting,
  hasTitle,
  appliedTemplate,
  onOpenTemplate,
  onClearTemplate,
  onSubmit,
}: NewTaskHeaderProps) {
  const router = useRouter();
  const tc = useTranslations('common');
  const t = useTranslations('task');

  const canCreate = hasTitle && !isSubmitting;
  // WHY-disabled lives in the tooltip only — the inline hint text was removed
  // by request (2026-07-14).
  const disabledHint = !hasTitle && !isSubmitting ? t('titleRequiredHint') : undefined;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">{tc('back')}</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Template button — フラット (テンプレート選択は表示補助操作) */}
          <button
            type="button"
            onClick={onOpenTemplate}
            className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-medium transition-colors duration-150
              ${
                appliedTemplate
                  ? 'text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/30'
                  : 'text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }
            `}
          >
            {/* LayoutTemplate — タスク詳細の「テンプレート設定」と同じグリフ。 */}
            <LayoutTemplate className="w-4 h-4" />
            <span className="font-mono text-xs font-black tracking-tight">
              {appliedTemplate ? appliedTemplate.name : t('template')}
            </span>
          </button>

          {/* 適用解除 — 適用中のみ表示。適用したフィールドを初期値に戻す。 */}
          {appliedTemplate && (
            <button
              type="button"
              onClick={onClearTemplate}
              title={t('clearTemplate')}
              aria-label={t('clearTemplate')}
              className="flex items-center justify-center p-2 rounded-lg text-purple-500 dark:text-purple-400 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:text-purple-700 dark:hover:text-purple-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Create button — ボトムリッジ (青) */}
          <button
            onClick={(e) => onSubmit(e)}
            disabled={!canCreate}
            title={disabledHint}
            className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-medium
              border transition-all duration-75
              ${
                !canCreate
                  ? 'opacity-50 cursor-not-allowed text-indigo-500 dark:text-indigo-500 bg-white dark:bg-zinc-900 border-indigo-200 dark:border-indigo-800 shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a5f]'
                  : 'text-indigo-700 dark:text-indigo-300 bg-white dark:bg-zinc-900 border-indigo-200 dark:border-indigo-800 shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a5f] hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:border-indigo-300 dark:hover:border-indigo-700 active:translate-y-[2px] active:shadow-none active:bg-indigo-50 dark:active:bg-indigo-900/20'
              }
            `}
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 dark:border-t-indigo-400 rounded-full animate-spin" />
            ) : (
              <ListPlus className="w-4 h-4" />
            )}
            <span className="font-mono text-xs font-black tracking-tight">{t('createSubmit')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
