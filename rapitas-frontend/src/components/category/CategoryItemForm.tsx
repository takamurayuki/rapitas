/**
 * CategoryItemForm
 *
 * Form UI for creating or editing a single category/label item.
 * Handles name, description, color picker, and icon selection.
 */
'use client';
import { Search, Save, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getIconComponent, ICON_DATA } from './icon-data';
import { IconGrid } from './IconGrid';
import type { CategoryManagerConfig } from './CategoryManager';
import type { CategoryFormData } from './useCategoryManager';

interface AccentClasses {
  ring: string;
  bg: string;
  iconBg: string;
}

interface CategoryItemFormProps {
  config: CategoryManagerConfig;
  accent: AccentClasses;
  formData: CategoryFormData;
  setFormData: (data: CategoryFormData) => void;
  iconSearchQuery: string;
  setIconSearchQuery: (q: string) => void;
  filteredIcons: string[];
  debouncedIconSearchQuery: string;
  isEdit: boolean;
  itemId?: number;
  onSave: (id?: number) => void;
  onCancel: () => void;
}

/**
 * Renders the icon at the given name, falling back to the config default.
 *
 * @param iconName - Lucide icon key
 * @param defaultIconName - Fallback icon key from config
 * @param size - Pixel size / 日本語: アイコンのピクセルサイズ
 * @returns React element for the icon
 */
function RenderIcon({
  iconName,
  defaultIconName,
  size = 20,
}: {
  iconName: string | null | undefined;
  defaultIconName: string;
  size?: number;
}) {
  const IconComponent = getIconComponent(iconName || '');
  if (!IconComponent) {
    const DefaultIcon =
      getIconComponent(defaultIconName) || ICON_DATA['Tag'].component;
    return <DefaultIcon size={size} />;
  }
  return <IconComponent size={size} />;
}

/**
 * Form for creating or editing a category item with name, description, color, and icon fields.
 *
 * @param props - Form state, configuration, and callback handlers
 */
export function CategoryItemForm({
  config,
  accent,
  formData,
  setFormData,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  isEdit,
  itemId,
  onSave,
  onCancel,
}: CategoryItemFormProps) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {config.itemName} <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder={t('itemNamePlaceholder', { item: config.itemName })}
          className={`w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all`}
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {tc('descriptionOptional')}
        </label>
        <textarea
          value={formData.description}
          onChange={(e) =>
            setFormData({ ...formData, description: e.target.value })
          }
          placeholder={t('descriptionPlaceholder')}
          rows={1}
          className={`w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all resize-none`}
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
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })
              }
              className="h-9 w-12 rounded-lg border border-zinc-300 dark:border-zinc-700 cursor-pointer"
            />
            <input
              type="text"
              value={formData.color}
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })
              }
              className={`flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all font-mono`}
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
            <div style={{ color: formData.color }}>
              <RenderIcon
                iconName={formData.icon}
                defaultIconName={config.defaultIcon}
                size={20}
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('selectIconLabel')}{' '}
          {!formData.icon &&
            t('iconNotSelectedDefault', { icon: config.defaultIcon })}
        </label>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
          <input
            type="text"
            value={iconSearchQuery}
            onChange={(e) => setIconSearchQuery(e.target.value)}
            placeholder={t('searchIconPlaceholder')}
            className={`w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 ${accent.ring} focus:border-transparent transition-all`}
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
              onIconSelect={(iconName) =>
                setFormData({ ...formData, icon: iconName })
              }
              renderIcon={(name, size) => (
                <RenderIcon
                  iconName={name}
                  defaultIconName={config.defaultIcon}
                  size={size}
                />
              )}
              accentClass={accent.iconBg}
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
          onClick={() => onSave(isEdit ? itemId : undefined)}
          className={`flex items-center gap-1.5 rounded-lg ${accent.bg} px-3 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium`}
        >
          <Save className="w-3.5 h-3.5" />
          {isEdit ? tc('save') : tc('create')}
        </button>
      </div>
    </div>
  );
}
