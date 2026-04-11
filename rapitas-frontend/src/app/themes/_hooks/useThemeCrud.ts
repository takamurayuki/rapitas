/**
 * useThemeCrud
 *
 * Provides CRUD operations (add, update, delete, set-default, reorder) for
 * themes. Extracted from useThemesPage to keep each hook file under the
 * 300-line limit.
 */
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { createLogger } from '@/lib/logger';
import type { Theme } from '@/types';
import type { DropResult } from '@hello-pangea/dnd';
import type { FormData } from './useThemesPage';

const logger = createLogger('useThemeCrud');

const addWorkingDirectoryToFavorites = async (path: string) => {
  if (!path.trim()) return;

  try {
    const checkRes = await fetch(`${API_BASE_URL}/directories/favorites`);
    const favorites = await checkRes.json();

    if (!Array.isArray(favorites)) return;

    const isAlreadyFavorite = favorites.some(
      (f: { path: string }) => f.path === path,
    );
    if (isAlreadyFavorite) return;

    await fetch(`${API_BASE_URL}/directories/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  } catch (err) {
    logger.error('Failed to add working directory to favorites:', err);
  }
};

type Options = {
  /** Returns current form state without triggering re-renders. */
  getFormData: () => FormData;
  /** Refreshes the theme list from the API. */
  fetchItems: () => void;
};

/**
 * CRUD hooks for the themes resource.
 *
 * @param options.getFormData - Stable ref accessor for the current form state.
 * @param options.fetchItems - Callback to re-fetch theme list after mutations.
 * @returns Action handlers: handleAdd, handleUpdate, handleDelete, setDefault, handleDragEnd.
 */
export function useThemeCrud({ getFormData, fetchItems }: Options) {
  const t = useTranslations('themes');
  const tc = useTranslations('common');
  const { showToast } = useToast();
  const clearFilterCache = useFilterDataStore((s) => s.clearCache);

  /**
   * Creates a new theme from the current form state.
   *
   * @param onSuccess - Called after the theme is successfully created.
   */
  const handleAdd = async (onSuccess: () => void) => {
    const formData = getFormData();

    if (!formData.name.trim()) {
      showToast(t('themeNameRequired'), 'error');
      return;
    }
    if (!formData.categoryId) {
      showToast(t('categoryRequired'), 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/themes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(tc('createFailed'));

      // NOTE: Auto-register working directory as favorite so it appears in the directory picker for future use.
      if (formData.isDevelopment && formData.workingDirectory) {
        await addWorkingDirectoryToFavorites(formData.workingDirectory);
      }

      showToast(t('created'), 'success');
      clearFilterCache();
      fetchItems();
      onSuccess();
    } catch (e) {
      logger.error(e);
      showToast(t('createFailed'), 'error');
    }
  };

  /**
   * Updates an existing theme by id.
   *
   * @param id - Id of the theme to update.
   * @param onSuccess - Called after a successful update.
   */
  const handleUpdate = async (id: number, onSuccess: () => void) => {
    const formData = getFormData();

    if (!formData.name.trim()) {
      showToast(t('themeNameRequired'), 'error');
      return;
    }
    if (!formData.categoryId) {
      showToast(t('categoryRequired'), 'error');
      return;
    }

    try {
      logger.debug('Updating theme with data:', formData);
      const res = await fetch(`${API_BASE_URL}/themes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const responseText = await res.text();
      logger.debug('Response status:', res.status, 'Response:', responseText);

      if (!res.ok) {
        let errorMessage = t('updateFailedStatus', {
          status: String(res.status),
        });
        try {
          const errorData = JSON.parse(responseText);
          if (errorData.error) errorMessage = errorData.error;
        } catch {
          // NOTE: Non-JSON error responses (e.g. plain text from reverse proxy) are used as-is.
          if (responseText) errorMessage = responseText;
        }
        throw new Error(errorMessage);
      }

      // NOTE: Auto-register working directory as favorite so it appears in the directory picker for future use.
      if (formData.isDevelopment && formData.workingDirectory) {
        await addWorkingDirectoryToFavorites(formData.workingDirectory);
      }

      showToast(t('updated'), 'success');
      clearFilterCache();
      fetchItems();
      onSuccess();
    } catch (e) {
      logger.error('Theme update error:', e);
      showToast(e instanceof Error ? e.message : t('updateFailed'), 'error');
    }
  };

  /**
   * Deletes a theme after a confirmation dialog.
   *
   * @param id - Id of the theme to delete.
   * @param name - Display name shown in the confirmation prompt. / 確認ダイアログに表示される名前
   */
  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('deleteConfirm', { name }))) return;

    try {
      const res = await fetch(`${API_BASE_URL}/themes/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(tc('deleteFailed'));
      showToast(t('deleted'), 'success');
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('deleteFailed'), 'error');
    }
  };

  /**
   * Sets a theme as the default for its category.
   *
   * @param id - Id of the theme to mark as default.
   */
  const setDefault = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/themes/${id}/set-default`, {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error(t('defaultSetFailed'));
      showToast(t('defaultSet'), 'success');
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('defaultSetFailed'), 'error');
    }
  };

  /**
   * Handles drag-and-drop reordering and persists new sort orders to the API.
   *
   * @param result - Drop result from @hello-pangea/dnd.
   * @param items - Current full list of themes (used to compute new sort order).
   * @param setItems - Setter for optimistic UI update.
   */
  const handleDragEnd = async (
    result: DropResult,
    items: Theme[],
    setItems: (items: Theme[]) => void,
  ) => {
    if (!result.destination || result.source.index === result.destination.index)
      return;

    const droppableId = result.source.droppableId;
    const categoryId = droppableId.startsWith('themes-category-')
      ? parseInt(droppableId.replace('themes-category-', ''))
      : null;

    if (categoryId === null) return;

    const categoryItems = items
      .filter((item) => item.categoryId === categoryId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    const reordered = Array.from(categoryItems);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    const reorderedMap = new Map(
      reordered.map((item, index) => [item.id, index]),
    );
    const newItems = items.map((item) => {
      if (reorderedMap.has(item.id)) {
        return { ...item, sortOrder: reorderedMap.get(item.id)! };
      }
      return item;
    });
    setItems(newItems);

    const orders = reordered.map((item, index) => ({
      id: item.id,
      sortOrder: index,
    }));

    try {
      const res = await fetch(`${API_BASE_URL}/themes/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error(t('reorderFailed'));
      clearFilterCache();
    } catch (e) {
      logger.error(e);
      showToast(t('reorderFailed'), 'error');
      fetchItems();
    }
  };

  return { handleAdd, handleUpdate, handleDelete, setDefault, handleDragEnd };
}
