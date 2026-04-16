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
          {/* Template button */}
          <div
            className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${
              appliedTemplate
                ? 'border-purple-500 dark:border-purple-400'
                : 'hover:border-purple-500 dark:hover:border-purple-400'
            }`}
          >
            <button
              type="button"
              onClick={onOpenTemplate}
              className={`flex items-center gap-2 transition-all cursor-pointer ${
                appliedTemplate
                  ? 'text-purple-700 dark:text-purple-300'
                  : 'text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300'
              }`}
            >
              <FileStack className="w-4 h-4" />
              <span className="font-mono text-xs font-black tracking-tight">
                {appliedTemplate ? appliedTemplate.name : t('template')}
              </span>
            </button>
          </div>

          {/* Create button */}
          <div
            className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 ${
              !canCreate
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:border-blue-500 dark:hover:border-blue-400'
            }`}
          >
            <button
              onClick={(e) => onSubmit(e)}
              disabled={!canCreate}
              className={`flex items-center gap-2 transition-all ${
                !canCreate
                  ? 'cursor-not-allowed text-gray-400 dark:text-gray-600'
                  : 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 cursor-pointer'
              }`}
            >
              {isSubmitting ? (
                <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-600 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span className="font-mono text-xs font-black tracking-tight">
                {tc('create')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
