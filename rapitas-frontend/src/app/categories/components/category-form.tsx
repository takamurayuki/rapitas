'use client';
// category-form

import { Search, X, Save, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getIconComponent } from '@/components/category/icon-data';
import { IconGrid } from '@/components/category/IconGrid';
import type { FormData } from '../hooks/useCategories';

/**
 * Returns a Lucide icon element for the given icon name, falling back to FolderKanban.
 *
 * @param iconName - Icon identifier or null / アイコン識別子(null可)
 * @param size - Icon size in pixels / アイコンサイズ(px)
 * @returns JSX element for the icon / アイコンのJSX要素
 */
export function renderIcon(iconName: string | null | undefined, size = 20) {
  const IconComponent = getIconComponent(iconName || '');
  if (IconComponent) return <IconComponent size={size} />;
  return <FolderKanban size={size} />;
}

/** Props for CategoryForm. */
interface CategoryFormProps {
  /** Whether this form is in edit mode (true) or create mode (false) / 編集モードかどうか */
  isEdit: boolean;
  /** ID of the item being edited; required when isEdit is true / 編集対象のID */
  itemId?: number;
  /** Current form values / 現在のフォーム値 */
  formData: FormData;
  /** Setter for form values / フォーム値のセッター */
  setFormData: (data: FormData) => void;
  /** Current icon search query / アイコン検索クエリ */
  iconSearchQuery: string;
  /** Setter for icon search query / アイコン検索クエリのセッター */
  setIconSearchQuery: (q: string) => void;
  /** Icon names matching the current search query (max 50) / 検索結果のアイコン名一覧 */
  filteredIcons: string[];
  /** Debounced icon search query used to detect the 50-result cap / デバウンス済みクエリ */
  debouncedIconSearchQuery: string;
  /** Called when the user cancels the form / キャンセル時のコールバック */
  onCancel: () => void;
  /** Called when the user submits the form / 送信時のコールバック */
  onSubmit: (id?: number) => void;
}

/**
 * Form for creating or editing a category.
 * Renders name, description, color, and icon selector.
 */
export function CategoryForm({
  isEdit,
  itemId,
  formData,
  setFormData,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  onCancel,
  onSubmit,
}: CategoryFormProps) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('categoryNameLabel')} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t('categoryNamePlaceholder')}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 transition-all"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {tc('descriptionOptional')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder={t('categoryDescriptionPlaceholder')}
          rows={1}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 transition-all resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {tc('color')}
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="h-9 w-12 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
            />
            <input
              type="text"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 transition-all font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('selectedIcon')}
          </label>
          <div
            className="h-9 rounded-lg border-2 flex items-center justify-center"
            style={{
              borderColor: formData.color,
              backgroundColor: formData.color + '15',
            }}
          >
            <div style={{ color: formData.color }}>{renderIcon(formData.icon, 20)}</div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('selectIconLabel')} {!formData.icon && t('iconNotSelected')}
        </label>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={iconSearchQuery}
            onChange={(e) => setIconSearchQuery(e.target.value)}
            placeholder={t('searchIconPlaceholder')}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:border-indigo-400 transition-all"
          />
        </div>

        <div className="max-h-36 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
          {filteredIcons.length === 50 && debouncedIconSearchQuery && (
            <div className="p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
              {t('iconLimitWarning')}
            </div>
          )}
          <div className="grid grid-cols-8 gap-1 p-2">
            <IconGrid
              icons={filteredIcons}
              selectedIcon={formData.icon}
              onIconSelect={(iconName) => setFormData({ ...formData, icon: iconName })}
              renderIcon={renderIcon}
              accentClass="bg-indigo-500"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all font-medium"
        >
          <X className="w-3.5 h-3.5" />
          {tc('cancel')}
        </button>
        <button
          onClick={() => onSubmit(itemId)}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
        >
          <Save className="w-3.5 h-3.5" />
          {isEdit ? tc('save') : tc('create')}
        </button>
      </div>
    </div>
  );
}
