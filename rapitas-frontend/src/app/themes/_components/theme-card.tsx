/**
 * ThemeCard
 *
 * Renders a single theme row in view mode (name, badges, action buttons).
 * Does not own any state or API calls.
 */
import {
  Edit2,
  Trash2,
  Star,
  Code,
  FolderOpen,
  GripVertical,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DraggableProvided } from '@hello-pangea/dnd';
import type { Theme } from '@/types';

type Props = {
  item: Theme;
  provided: DraggableProvided;
  renderIcon: (
    iconName: string | null | undefined,
    size?: number,
  ) => React.ReactNode;
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
export function ThemeCard({
  item,
  provided,
  renderIcon,
  onEdit,
  onDelete,
  onSetDefault,
}: Props) {
  const t = useTranslations('themes');
  const tc = useTranslations('common');

  return (
    <div className="p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        {/* Drag handle */}
        <div
          {...provided.dragHandleProps}
          className="flex items-center justify-center w-6 shrink-0 cursor-grab active:cursor-grabbing text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
          title={t('dragToReorder')}
        >
          <GripVertical className="w-5 h-5" />
        </div>

        {/* Icon */}
        <div
          className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0 shadow-sm"
          style={{
            backgroundColor: item.color + '20',
            color: item.color,
          }}
        >
          {renderIcon(item.icon, 20)}
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 truncate">
              {item.name}
            </h3>
            {item.isDevelopment && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                <Code className="w-3 h-3" />
                <span className="hidden sm:inline">{t('development')}</span>
              </span>
            )}
          </div>

          {item.description && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-1">
              {item.description}
            </p>
          )}

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            {/* Color badge */}
            <span
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded"
              style={{
                backgroundColor: item.color + '15',
                color: item.color,
              }}
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              {item.color}
            </span>

            {/* Task count */}
            {item._count && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                <span className="font-semibold">{item._count.tasks}</span>
                <span className="hidden sm:inline">{t('tasks')}</span>
              </span>
            )}

            {/* Working directory (truncated) */}
            {item.isDevelopment && item.workingDirectory && (
              <span className="hidden md:flex text-xs text-zinc-500 dark:text-zinc-400 items-center gap-1 font-mono">
                <FolderOpen className="w-3 h-3" />
                {item.workingDirectory.length > 30
                  ? '...' + item.workingDirectory.slice(-27)
                  : item.workingDirectory}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => onSetDefault(item.id)}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-all font-medium ${
            item.isDefault
              ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 border-2 border-purple-500'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          }`}
          title={
            item.isDefault
              ? t('defaultInCategory', {
                  category: item.category?.name ?? 'Category',
                })
              : t('setDefaultInCategory', {
                  category: item.category?.name ?? 'Category',
                })
          }
        >
          <Star
            className={`w-3.5 h-3.5 ${item.isDefault ? 'fill-current' : ''}`}
          />
          <span className="hidden sm:inline">
            {item.isDefault ? t('default') : t('setAsDefault')}
          </span>
        </button>

        <button
          onClick={() => onEdit(item)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1.5 text-sm text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-all font-medium"
        >
          <Edit2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{tc('edit')}</span>
        </button>

        <button
          onClick={() => onDelete(item.id, item.name)}
          className="flex items-center gap-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 px-2.5 py-1.5 text-sm text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-all font-medium"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{tc('delete')}</span>
        </button>
      </div>
    </div>
  );
}
