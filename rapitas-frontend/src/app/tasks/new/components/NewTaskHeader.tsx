'use client';
// NewTaskHeader
import { ArrowLeft, FileStack, Plus } from 'lucide-react';
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
  onSubmit,
}: NewTaskHeaderProps) {
  const router = useRouter();
  const tc = useTranslations('common');
  const t = useTranslations('task');

  const canCreate = hasTitle && !isSubmitting;

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
          {/* Template button — ボトムリッジ (紫) */}
          <button
            type="button"
            onClick={onOpenTemplate}
            className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-medium
              border transition-all duration-75
              ${
                appliedTemplate
                  ? 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 translate-y-[2px] shadow-none'
                  : 'text-purple-600 dark:text-purple-400 bg-white dark:bg-zinc-900 border-purple-200 dark:border-purple-800 shadow-[0_2px_0_0_#d8b4fe] dark:shadow-[0_2px_0_0_#4c1d95] hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-700 active:translate-y-[2px] active:shadow-none active:bg-purple-50 dark:active:bg-purple-900/20'
              }
            `}
          >
            <FileStack className="w-4 h-4" />
            <span className="font-mono text-xs font-black tracking-tight">
              {appliedTemplate ? appliedTemplate.name : t('template')}
            </span>
          </button>

          {/* Create button — ボトムリッジ (青) */}
          <button
            onClick={(e) => onSubmit(e)}
            disabled={!canCreate}
            className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-medium
              border transition-all duration-75
              ${
                !canCreate
                  ? 'opacity-50 cursor-not-allowed text-blue-500 dark:text-blue-500 bg-white dark:bg-zinc-900 border-blue-200 dark:border-blue-800 shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a5f]'
                  : 'text-blue-700 dark:text-blue-300 bg-white dark:bg-zinc-900 border-blue-200 dark:border-blue-800 shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a5f] hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700 active:translate-y-[2px] active:shadow-none active:bg-blue-50 dark:active:bg-blue-900/20'
              }
            `}
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            <span className="font-mono text-xs font-black tracking-tight">{tc('create')}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
