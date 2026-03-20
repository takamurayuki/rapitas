/**
 * FolderCreator
 *
 * Renders the "folder not found" warning together with buttons to create
 * the exact path or a differently-named sibling folder. Extracted from
 * DevProjectFields to keep that component under the 300-line limit.
 */
import { FolderPlus, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Props = {
  newFolderName: string;
  setNewFolderName: (name: string) => void;
  isCreatingDir: boolean;
  showCreateFolder: boolean;
  onCreateDirectory: () => void;
  onCreateNewFolder: () => void;
};

/**
 * Warning banner and folder-creation controls shown when a working directory
 * path does not exist on disk.
 *
 * @param props.newFolderName - Current value of the alternative folder name input.
 * @param props.setNewFolderName - Setter for the alternative folder name.
 * @param props.isCreatingDir - True while a creation request is in flight.
 * @param props.showCreateFolder - Whether to show the alternative-name sub-section.
 * @param props.onCreateDirectory - Creates the exact path from formData.workingDirectory.
 * @param props.onCreateNewFolder - Creates a sibling folder named newFolderName.
 */
export function FolderCreator({
  newFolderName,
  setNewFolderName,
  isCreatingDir,
  showCreateFolder,
  onCreateDirectory,
  onCreateNewFolder,
}: Props) {
  const t = useTranslations('themes');

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
        <AlertCircle className="w-3.5 h-3.5" />
        {t('folderNotFound')}
      </div>

      <div className="p-2 bg-amber-50 dark:bg-amber-900/10 rounded border border-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCreateDirectory}
            disabled={isCreatingDir}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isCreatingDir ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <FolderPlus className="w-3 h-3" />
            )}
            {t('createFolder')}
          </button>
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {t('createFolderAtPath')}
          </span>
        </div>

        {showCreateFolder && (
          <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
            <p className="text-xs text-amber-700 dark:text-amber-300 mb-1">
              {t('differentFolderName')}
            </p>
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCreateNewFolder();
                }}
                placeholder={t('folderNamePlaceholder')}
                className="flex-1 px-2 py-1 text-xs bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-600 rounded focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                disabled={isCreatingDir}
              />
              <button
                type="button"
                onClick={onCreateNewFolder}
                disabled={!newFolderName.trim() || isCreatingDir}
                className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreatingDir ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FolderPlus className="w-3 h-3" />
                )}
                {t('createFolder')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
