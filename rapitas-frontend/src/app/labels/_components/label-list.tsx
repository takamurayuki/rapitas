/**
 * LabelList
 *
 * Renders the list of labels for the selected theme with inline
 * add / edit / delete. Card style mirrors ThemeCard and CategoryItem.
 */
'use client';
import { Pencil, Trash2, Tag } from 'lucide-react';
import type { LabelItem, LabelFormData } from '../_hooks/useLabelsPage';
import { LabelForm } from './label-form';

type Props = {
  labels: LabelItem[];
  editingId: number | null;
  formData: LabelFormData;
  setFormData: (data: LabelFormData) => void;
  iconSearchQuery: string;
  setIconSearchQuery: (q: string) => void;
  filteredIcons: string[];
  debouncedIconSearchQuery: string;
  renderIcon: (iconName: string | null | undefined, size?: number) => React.ReactNode;
  onEdit: (label: LabelItem) => void;
  onDelete: (id: number) => void;
  onSave: (id: number) => void;
  onCancel: () => void;
};

/**
 * Shows a card per label with inline edit form when editing.
 */
export function LabelList({
  labels,
  editingId,
  formData,
  setFormData,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  renderIcon,
  onEdit,
  onDelete,
  onSave,
  onCancel,
}: Props) {
  if (labels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 dark:text-zinc-600">
        <Tag className="w-10 h-10 mb-3 opacity-40" />
        <p className="text-sm">このテーマにラベルはまだありません</p>
        <p className="text-xs mt-1">上の「ラベルを追加」から作成できます</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {labels.map((label) =>
        editingId === label.id ? (
          <div
            key={label.id}
            className="rounded-xl border-2 border-indigo-500 bg-white dark:bg-zinc-900 p-4 shadow-lg"
          >
            <LabelForm
              formData={formData}
              setFormData={setFormData}
              iconSearchQuery={iconSearchQuery}
              setIconSearchQuery={setIconSearchQuery}
              filteredIcons={filteredIcons}
              debouncedIconSearchQuery={debouncedIconSearchQuery}
              renderIcon={renderIcon}
              onSave={() => onSave(label.id)}
              onCancel={onCancel}
            />
          </div>
        ) : (
          <div
            key={label.id}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors"
          >
            <div className="px-4 py-3 flex items-center gap-3">
              {/* Icon swatch */}
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: label.color + '20', color: label.color }}
              >
                {renderIcon(label.icon, 20)}
              </div>

              {/* Name + description */}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate block">
                  {label.name}
                </span>
                {label.description && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                    {label.description}
                  </p>
                )}
                <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 block">
                  {label._count.tasks} タスク
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onEdit(label)}
                  className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
                  title="編集"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onDelete(label.id)}
                  className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title="削除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}
