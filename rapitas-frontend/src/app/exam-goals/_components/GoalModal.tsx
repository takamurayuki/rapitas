'use client';
// GoalModal

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ICON_DATA, searchIcons } from '@/components/category/icon-data';
import { PRESET_COLORS } from './constants';
import { renderGoalIcon } from './GoalCard';
import type { ExamGoalFormData } from './constants';

interface GoalModalProps {
  isEditing: boolean;
  formData: ExamGoalFormData;
  onChange: (data: ExamGoalFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

/**
 * Full-screen modal overlay with exam goal form.
 *
 * @param props.isEditing - Whether the form is editing an existing goal / 既存の目標を編集中かどうか
 * @param props.formData - Current form state / 現在のフォーム状態
 * @param props.onChange - Setter for form state / フォーム状態のセッター
 * @param props.onSubmit - Form submit handler / フォーム送信ハンドラー
 * @param props.onClose - Close modal handler / モーダルを閉じるハンドラー
 */
export function GoalModal({
  isEditing,
  formData,
  onChange,
  onSubmit,
  onClose,
}: GoalModalProps) {
  const t = useTranslations('examGoals');
  const tc = useTranslations('common');
  const [iconSearch, setIconSearch] = useState('');
  const [showIconPicker, setShowIconPicker] = useState(false);

  const filteredIcons = iconSearch
    ? searchIcons(iconSearch)
    : Object.keys(ICON_DATA).slice(0, 30);

  const set = (partial: Partial<ExamGoalFormData>) =>
    onChange({ ...formData, ...partial });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-800 rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4">
            {isEditing ? t('editTitle') : t('newTitle')}
          </h2>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('examName')}
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder={t('examNameExample')}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('examDate')}
              </label>
              <input
                type="date"
                value={formData.examDate}
                onChange={(e) => set({ examDate: e.target.value })}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('targetScore')}
              </label>
              <input
                type="text"
                value={formData.targetScore}
                onChange={(e) => set({ targetScore: e.target.value })}
                placeholder={t('scoreExample')}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {tc('descriptionOptional')}
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder={t('descriptionPlaceholder')}
                rows={2}
                className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {tc('color')}
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => set({ color })}
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

            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                {tc('icon')}
              </label>
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="flex items-center gap-2 px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 hover:bg-zinc-50 dark:hover:bg-zinc-600 transition-colors"
              >
                <span style={{ color: formData.color }}>
                  {renderGoalIcon(formData.icon, 20)}
                </span>
                <span className="text-sm">
                  {formData.icon || tc('selectIcon')}
                </span>
              </button>

              {showIconPicker && (
                <div className="mt-2 p-3 border border-zinc-200 dark:border-zinc-600 rounded-lg bg-zinc-50 dark:bg-zinc-700">
                  <input
                    type="text"
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.target.value)}
                    placeholder={tc('searchIcon')}
                    className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-lg bg-white dark:bg-zinc-800 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="grid grid-cols-6 gap-1 max-h-40 overflow-y-auto">
                    {filteredIcons.map((iconName) => (
                      <button
                        key={iconName}
                        type="button"
                        onClick={() => {
                          set({ icon: iconName });
                          setShowIconPicker(false);
                          setIconSearch('');
                        }}
                        className={`p-2 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors ${
                          formData.icon === iconName
                            ? 'bg-zinc-200 dark:bg-zinc-600'
                            : ''
                        }`}
                        title={iconName}
                      >
                        {renderGoalIcon(iconName, 18)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

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
                className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                {isEditing ? tc('update') : tc('create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
