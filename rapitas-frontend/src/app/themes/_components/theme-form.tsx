/**
 * ThemeForm
 *
 * Renders the create/edit form for a single theme: name, description, color,
 * icon picker, category selector, and development-project fields.
 * The dev-project section is delegated to DevProjectFields.
 * Does not own any async logic.
 */
import { Save, X, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconGrid } from '@/components/category/IconGrid';
import type { Category } from '@/types';
import type { FormData } from '../_hooks/useThemesPage';
import { DevProjectFields } from './dev-project-fields';

type DirStatus = {
  checking: boolean;
  exists: boolean | null;
  isGitRepo: boolean;
};

type Props = {
  isEdit: boolean;
  itemId?: number;
  formData: FormData;
  setFormData: (data: FormData) => void;
  categories: Category[];
  selectedCategoryId: number | null;
  iconSearchQuery: string;
  setIconSearchQuery: (q: string) => void;
  filteredIcons: string[];
  debouncedIconSearchQuery: string;
  dirStatus: DirStatus;
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  isCreatingDir: boolean;
  showCreateFolder: boolean;
  branches: string[];
  loadingBranches: boolean;
  branchError: string | null;
  setBranches: (b: string[]) => void;
  setBranchError: (e: string | null) => void;
  editingId: number | null;
  renderIcon: (
    iconName: string | null | undefined,
    size?: number,
  ) => React.ReactNode;
  onSave: (itemId?: number) => void;
  onCancel: () => void;
  onCheckDirectory: (path: string) => void;
  onFetchBranches: (repoUrl: string) => void;
  onCreateDirectory: () => void;
  onCreateNewFolder: () => void;
};

/**
 * Full theme create/edit form.
 *
 * @param props.isEdit - True when editing an existing theme, false for creation.
 * @param props.itemId - Id of the theme being edited (only used when isEdit is true).
 * @param props.onSave - Called when the save button is clicked. / 保存ボタンクリック時に呼ばれる
 * @param props.onCancel - Called when the cancel button is clicked. / キャンセル時に呼ばれる
 */
export function ThemeForm({
  isEdit,
  itemId,
  formData,
  setFormData,
  categories,
  selectedCategoryId,
  iconSearchQuery,
  setIconSearchQuery,
  filteredIcons,
  debouncedIconSearchQuery,
  dirStatus,
  newFolderName,
  setNewFolderName,
  isCreatingDir,
  showCreateFolder,
  branches,
  loadingBranches,
  branchError,
  setBranches,
  setBranchError,
  editingId,
  renderIcon,
  onSave,
  onCancel,
  onCheckDirectory,
  onFetchBranches,
  onCreateDirectory,
  onCreateNewFolder,
}: Props) {
  const t = useTranslations('themes');
  const tc = useTranslations('common');

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('themeName')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder={t('themeNamePlaceholder')}
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            autoFocus
          />
        </div>

        {/* Description */}
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
            className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all resize-none"
          />
        </div>

        {/* Color + Icon preview */}
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
                className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all font-mono"
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
                {renderIcon(formData.icon, 20)}
              </div>
            </div>
          </div>
        </div>

        {/* Icon picker */}
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
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
                renderIcon={renderIcon}
                accentClass="bg-purple-500"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Category selector */}
      {categories.length > 0 && (
        <div className="border-t border-zinc-200 dark:border-zinc-700 pt-4 space-y-3">
          <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t('belongsToCategory')} <span className="text-red-500">*</span>
          </label>
          {selectedCategoryId !== null ? (
            <div className="flex items-center gap-2">
              {(() => {
                const cat = categories.find(
                  (c) => c.id === formData.categoryId,
                );
                if (!cat) return null;
                return (
                  <span
                    className="inline-flex items-center gap-2 text-sm font-medium px-3 py-2 rounded-lg"
                    style={{
                      backgroundColor: cat.color + '15',
                      color: cat.color,
                      border: `1px solid ${cat.color}40`,
                    }}
                  >
                    {renderIcon(cat.icon, 16)}
                    {cat.name}
                  </span>
                );
              })()}
            </div>
          ) : (
            <select
              value={formData.categoryId ?? ''}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  categoryId: e.target.value ? Number(e.target.value) : null,
                })
              }
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
            >
              <option value="" disabled>
                {t('selectCategory')}
              </option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Dev-project section */}
      <DevProjectFields
        formData={formData}
        setFormData={setFormData}
        categories={categories}
        dirStatus={dirStatus}
        newFolderName={newFolderName}
        setNewFolderName={setNewFolderName}
        isCreatingDir={isCreatingDir}
        showCreateFolder={showCreateFolder}
        branches={branches}
        loadingBranches={loadingBranches}
        branchError={branchError}
        setBranches={setBranches}
        setBranchError={setBranchError}
        editingId={editingId}
        onCheckDirectory={onCheckDirectory}
        onFetchBranches={onFetchBranches}
        onCreateDirectory={onCreateDirectory}
        onCreateNewFolder={onCreateNewFolder}
      />

      {/* Action buttons */}
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
          className="flex items-center gap-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 px-3 py-2 text-sm text-white transition-all shadow-lg hover:shadow-xl font-medium"
        >
          <Save className="w-3.5 h-3.5" />
          {isEdit ? tc('save') : tc('create')}
        </button>
      </div>
    </div>
  );
}
