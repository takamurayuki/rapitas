'use client';

/**
 * daily-schedule/_components/BlockFormModal
 *
 * Modal dialog for creating and editing DailyScheduleBlock records.
 * Renders the form fields (label, category, time range, color, notification)
 * and delegates submission to the parent via onSubmit.
 * Not responsible for data fetching.
 */

import { Bell, BellOff, Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DailyScheduleBlock } from '@/types';
import { CATEGORY_OPTIONS, PRESET_COLORS } from './schedule-utils';
import type { BlockFormData } from './useScheduleBlocks';

type BlockFormModalProps = {
  isOpen: boolean;
  editingBlock: DailyScheduleBlock | null;
  formData: BlockFormData;
  onFormChange: React.Dispatch<React.SetStateAction<BlockFormData>>;
  onCategoryChange: (category: string) => void;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  onClose: () => void;
};

/**
 * Renders the create/edit modal for a schedule block.
 *
 * @param isOpen - Whether the modal is visible / モーダル表示フラグ
 * @param editingBlock - Block being edited, or null for new / 編集中ブロック
 * @param formData - Controlled form values / フォームデータ
 * @param onFormChange - Dispatch function for form updates / フォーム更新ディスパッチ
 * @param onCategoryChange - Called when the category is changed (also updates color) / カテゴリ変更コールバック
 * @param onSubmit - Called on form submit / フォーム送信コールバック
 * @param onClose - Called to dismiss the modal / 閉じるコールバック
 */
export function BlockFormModal({
  isOpen,
  editingBlock,
  formData,
  onFormChange,
  onCategoryChange,
  onSubmit,
  onClose,
}: BlockFormModalProps) {
  const t = useTranslations('habits');
  const tc = useTranslations('common');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
            {editingBlock ? t('editBlock') : t('newBlock')}
          </h2>

          <form onSubmit={onSubmit} className="space-y-4">
            {/* Label */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('blockLabel')}
              </label>
              <input
                type="text"
                value={formData.label}
                onChange={(e) =>
                  onFormChange((prev) => ({ ...prev, label: e.target.value }))
                }
                placeholder={t('blockLabelPlaceholder')}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>

            {/* Category selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {t('blockCategory')}
              </label>
              <div className="grid grid-cols-4 gap-2">
                {CATEGORY_OPTIONS.map((cat) => {
                  const CatIcon = cat.icon;
                  const isSelected = formData.category === cat.value;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => onCategoryChange(cat.value)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all text-xs ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                          : 'border-zinc-200 dark:border-zinc-600 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      <CatIcon className="w-5 h-5" />
                      {t(cat.labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time range */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('startTime')}
                </label>
                <input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) =>
                    onFormChange((prev) => ({
                      ...prev,
                      startTime: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('endTime')}
                </label>
                <input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) =>
                    onFormChange((prev) => ({
                      ...prev,
                      endTime: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Color picker */}
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {tc('color')}
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onFormChange((prev) => ({ ...prev, color }))}
                    className={`w-8 h-8 rounded-full border-2 transition-all ${
                      formData.color === color
                        ? 'border-zinc-900 dark:border-white scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* Notification toggle */}
            <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-700/50 rounded-lg">
              <button
                type="button"
                onClick={() =>
                  onFormChange((prev) => ({
                    ...prev,
                    isNotify: !prev.isNotify,
                  }))
                }
                className={`p-2 rounded-lg transition-colors ${
                  formData.isNotify
                    ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600'
                    : 'bg-zinc-200 dark:bg-zinc-600 text-zinc-400'
                }`}
              >
                {formData.isNotify ? (
                  <Bell className="w-5 h-5" />
                ) : (
                  <BellOff className="w-5 h-5" />
                )}
              </button>
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t('pcNotification')}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {formData.isNotify
                    ? t('notifyOnDescription')
                    : t('notifyOffDescription')}
                </p>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
              >
                {tc('cancel')}
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {editingBlock ? tc('update') : tc('create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
