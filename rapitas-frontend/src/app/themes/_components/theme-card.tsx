/**
 * ThemeCard
 *
 * Renders a single theme row in view mode (name, badges, action buttons).
 * Does not own any state or API calls.
 */
import { Pencil, Trash2, Star, Code, FolderOpen, GripVertical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DraggableProvided } from '@hello-pangea/dnd';
import type { Theme } from '@/types';

type Props = {
  item: Theme;
  provided: DraggableProvided;
  renderIcon: (iconName: string | null | undefined, size?: number) => React.ReactNode;
  onEdit: (item: Theme) => void;
  onDelete: (id: number, name: string) => void;
  onSetDefault: (id: number) => void;
};

/**
 * Displays a theme's metadata with drag handle and CRUD action buttons.
 *
 * @param props.item - The theme data to display.
 * @param props.provided - Drag-and-drop handle/ref from @hello-pangea/dnd.
 * @param props.renderIcon - Utility to render a Lucide icon by name.
 * @param props.onEdit - Called with the theme when the edit button is clicked.
 * @param props.onDelete - Called with (id, name) when the delete button is clicked.
 * @param props.onSetDefault - Called with the theme id when the star button is clicked.
 */
export function ThemeCard({ item, provided, renderIcon, onEdit, onDelete, onSetDefault }: Props) {
  const t = useTranslations('themes');
  const tc = useTranslations('common');

  return (
    <div className="px-4 py-3 flex items-center gap-3">
      {/* Drag handle */}
      <div
        {...provided.dragHandleProps}
        className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-300 dark:text-zinc-600 hover:text-zinc-500 dark:hover:text-zinc-400 transition-colors"
        title={t('dragToReorder')}
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Icon swatch */}
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
        style={{ backgroundColor: item.color + '20', color: item.color }}
      >
        {renderIcon(item.icon, 20)}
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 truncate">
            {item.name}
          </span>
          {item.isDefault && (
            <Star
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: item.color, fill: item.color }}
            />
          )}
          {item.isDevelopment && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 shrink-0">
              <Code className="w-2.5 h-2.5" />
              Dev
            </span>
          )}
        </div>

        {item.description && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
            {item.description}
          </p>
        )}

        <div className="flex items-center gap-2 mt-1">
          {item._count && (
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {item._count.tasks} {t('tasks')}
            </span>
          )}
          {item.isDevelopment && item.workingDirectory && (
            <span className="hidden md:flex text-xs text-zinc-500 dark:text-zinc-500 items-center gap-1 font-mono">
              <FolderOpen className="w-3 h-3" />
              {item.workingDirectory.length > 30
                ? '...' + item.workingDirectory.slice(-27)
                : item.workingDirectory}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onSetDefault(item.id)}
          className={`p-2 rounded-lg transition-colors ${
            item.isDefault
              ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20'
              : 'text-zinc-400 hover:text-purple-600 dark:hover:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/20'
          }`}
          title={item.isDefault ? t('default') : t('setAsDefault')}
        >
          <Star className={`w-4 h-4 ${item.isDefault ? 'fill-current' : ''}`} />
        </button>
        <button
          onClick={() => onEdit(item)}
          className="p-2 text-zinc-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors"
          title={tc('edit')}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(item.id, item.name)}
          className="p-2 text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          title={tc('delete')}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
