/**
 * use-categories
 *
 * Custom hook encapsulating all data-fetching and mutation logic for the Categories page.
 * Not responsible for rendering; consumers must supply their own UI.
 */

'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { type DropResult } from '@hello-pangea/dnd';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { searchIcons } from '@/components/category/IconData';
import type { Category, CategoryMode, Theme } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useDebounce } from '@/hooks/common/useDebounce';
import { useFilterDataStore } from '@/stores/filterDataStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useCategories');

/** A category enriched with its child themes and task counts. */
export type CategoryWithThemes = Category & {
  themes: (Pick<Theme, 'id' | 'name' | 'color' | 'icon' | 'isDefault'> & {
    _count?: { tasks: number };
  })[];
};

/** Shape of the category create/edit form. */
export type FormData = {
  name: string;
  description: string;
  color: string;
  icon: string;
  mode: CategoryMode;
};

/** Initial/empty state for the form. */
export const defaultFormData: FormData = {
  name: '',
  description: '',
  color: '#6366F1',
  icon: '',
  mode: 'both',
};

/**
 * Manages categories state, API calls, form state, icon search, and drag-and-drop reordering.
 *
 * @returns All state and handlers needed by the Categories page and its sub-components
 */
export function useCategories() {
  const t = useTranslations('categories');
  const tc = useTranslations('common');
  const { showToast } = useToast();
  const clearFilterCache = useFilterDataStore((s) => s.clearCache);

  const [items, setItems] = useState<CategoryWithThemes[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState('');
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [defaultCategoryId, setDefaultCategoryId] = useState<number | null>(null);

  const seedDefaults = async () => {
    try {
      await fetch(`${API_BASE_URL}/categories/seed-defaults`, { method: 'POST' });
    } catch (e) {
      logger.error('Failed to seed default categories:', e);
    }
  };

  const fetchDefaultCategory = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/settings`);
      if (res.ok) {
        const data = await res.json();
        setDefaultCategoryId(data.defaultCategoryId ?? null);
      }
    } catch (e) {
      logger.error('Failed to fetch default category:', e);
    }
  };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (!res.ok) throw new Error(tc('fetchFailed'));
      setItems(await res.json());
    } catch (e) {
      logger.error(e);
      showToast(t('fetchFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    seedDefaults().then(() => {
      fetchItems();
      fetchDefaultCategory();
    });
  }, [fetchItems]);

  const resetForm = () => {
    setFormData(defaultFormData);
    setIconSearchQuery('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetForm();
  };

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast(t('categoryNameRequired'), 'error');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(tc('createFailed'));
      showToast(t('created'), 'success');
      setIsAdding(false);
      resetForm();
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('createFailed'), 'error');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast(t('categoryNameRequired'), 'error');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error(tc('updateFailed'));
      showToast(t('updated'), 'success');
      setEditingId(null);
      setIconSearchQuery('');
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('updateFailed'), 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('deleteConfirm', { name }))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(tc('deleteFailed'));
      showToast(t('deleted'), 'success');
      clearFilterCache();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('deleteFailed'), 'error');
    }
  };

  const setDefaultCategory = async (id: number) => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories/${id}/set-default`, {
        method: 'PATCH',
      });
      if (!res.ok) throw new Error(t('setDefaultFailed'));
      setDefaultCategoryId(id);
      localStorage.setItem('selectedCategoryFilter', String(id));
      showToast(t('defaultCategorySet'), 'success');
    } catch (e) {
      logger.error(e);
      showToast(t('defaultCategorySetFailed'), 'error');
    }
  };

  const startEdit = (item: CategoryWithThemes) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || '',
      color: item.color,
      icon: item.icon || '',
      mode: item.mode || 'both',
    });
    setIconSearchQuery('');
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index) return;

    const reordered = Array.from(items);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);
    setItems(reordered);

    const orders = reordered.map((item, index) => ({ id: item.id, sortOrder: index }));
    try {
      const res = await fetch(`${API_BASE_URL}/categories/reorder`, {
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

  const debouncedIconSearchQuery = useDebounce(iconSearchQuery, 300);

  const filteredIcons = useMemo(() => {
    const results = searchIcons(debouncedIconSearchQuery);
    return results.slice(0, 50);
  }, [debouncedIconSearchQuery]);

  return {
    items,
    loading,
    editingId,
    isAdding,
    setIsAdding,
    iconSearchQuery,
    setIconSearchQuery,
    formData,
    setFormData,
    defaultCategoryId,
    filteredIcons,
    debouncedIconSearchQuery,
    handleAdd,
    handleUpdate,
    handleDelete,
    setDefaultCategory,
    startEdit,
    cancelEdit,
    resetForm,
    handleDragEnd,
  };
}
