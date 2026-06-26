/**
 * LabelForm
 *
 * Create / edit form for a label. Mirrors the ThemeForm UI style:
 * name, description, color + icon preview, flexible icon picker (with search),
 * and theme selector. No category field — category is determined by the tabs.
 */
'use client';
import { Save, X, Search } from 'lucide-react';
import { IconGrid } from '@/components/category/IconGrid';
import type { LabelFormData } from '../_hooks/useLabelsPage';

type Props = {
  formData: LabelFormData;
  setFormData: (data: LabelFormData) => void;
  iconSearchQuery: string;
  setIconSearchQuery: (q: string) => void;
  filteredIcons: string[];
  debouncedIconSearchQuery: string;
  renderIcon: (iconName: string | null | undefined, size?: number) => React.ReactNode;
  onSave: () => void;
  onCancel: () => void;
};

/**
 * Full label create/edit form — matches ThemeForm layout.
 *
 * @param props.formData - Current form state.
 * @param props.setFormData - Setter for form state.
 * @param props.themes - Available themes for the themeId selector.
 * @param props.iconSearchQuery - Current icon search input value.
 * @param props.setIconSearchQuery - Setter for icon search.
 * @param props.filteredIcons - Icon names matching the current search.
 * @param props.debouncedIconSearchQuery - Debounced search value (used for limit warning).
 * @param props.renderIcon - Utility to render a Lucide icon by name.
 * @param props.onSave - Called when the user confirms the form.
 * @param props.onCancel - Called when the user dismisses the form.
 */
export function LabelForm({
  formData,
  setFormData,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  renderIcon,
  onSave,
  onCancel,
}: Props) {
  const set = (patch: Partial<LabelFormData>) => setFormData({ ...formData, ...patch });

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            ラベル名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="例: バグ修正"
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-all"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            説明（任意）
          </label>
          <textarea
            value={formData.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="ラベルの説明を入力"
            rows={1}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-all resize-none"
          />
        </div>

        {/* Color + Icon preview */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              カラー
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={formData.color}
                onChange={(e) => set({ color: e.target.value })}
                className="h-9 w-12 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
              />
              <input
                type="text"
                value={formData.color}
                onChange={(e) => set({ color: e.target.value })}
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-all font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              選択中のアイコン
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

        {/* Icon picker */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            アイコンを選択{!formData.icon && ' （未選択）'}
          </label>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
            <input
              type="text"
              value={iconSearchQuery}
              onChange={(e) => setIconSearchQuery(e.target.value)}
              placeholder="アイコンを検索..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:border-blue-400 transition-all"
            />
          </div>
          <div className="max-h-36 overflow-y-auto border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800/50">
            {filteredIcons.length === 50 && debouncedIconSearchQuery && (
              <div className="p-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
                上位50件を表示しています。検索を絞り込んでください。
              </div>
            )}
            <div className="grid grid-cols-8 gap-1 p-2">
              <IconGrid
                icons={filteredIcons}
                selectedIcon={formData.icon}
                onIconSelect={(iconName) => set({ icon: iconName })}
                renderIcon={(name, size) => renderIcon(name, size)}
                accentClass="bg-indigo-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end pt-1">
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-200 dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-all font-medium"
        >
          <X className="w-3.5 h-3.5" />
          キャンセル
        </button>
        <button
          onClick={onSave}
          disabled={!formData.name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Save className="w-3.5 h-3.5" />
          保存
        </button>
      </div>
    </div>
  );
}
