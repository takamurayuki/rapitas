/**
 * useCategoryManager
 *
 * Custom hook that encapsulates all state and API logic for CategoryManager.
 * Does not handle any rendering or UI concerns.
 */
'use client';
import { useEffect, useState, useMemo } from 'react';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { searchIcons } from './IconData';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useDebounce } from '@/hooks/useDebounce';
import { createLogger } from '@/lib/logger';
import type { CategoryItem, CategoryManagerConfig } from './CategoryManager';
import type { DropResult } from '@hello-pangea/dnd';

const logger = createLogger('useCategoryManager');

export interface CategoryFormData {
  name: string;
  description: string;
  color: string;
  icon: string;
}

/**
 * Manages CRUD operations, form state, drag-and-drop reordering, and icon search for a category list.
 *
 * @param config - CategoryManagerConfig controlling API endpoint, defaults, and display labels
 * @returns State and handlers for the CategoryManager UI
 */
export function useCategoryManager(config: CategoryManagerConfig) {
  const t = useTranslations('categories');
  const tc = useTranslations('common');
  const { showToast } = useToast();

  const [items, setItems] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState('');

  const [formData, setFormData] = useState<CategoryFormData>({
    name: '',
    description: '',
    color: config.defaultColor,
    icon: '',
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}`);
      if (!res.ok) throw new Error(tc('fetchFailed'));
      setItems(await res.json());
    } catch (e) {
      logger.error(e);
      showToast(t('itemFetchFailed', { item: config.itemName }), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
    // NOTE: fetchItems is intentionally not in the deps array — it should only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAdd = async () => {
    if (!formData.name.trim()) {
      showToast(t('itemNameRequired', { item: config.itemName }), 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(tc('createFailed'));

      showToast(t('itemCreated', { item: config.itemName }), 'success');
      setIsAdding(false);
      resetForm();
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('itemCreateFailed', { item: config.itemName }), 'error');
    }
  };

  const handleUpdate = async (id: number) => {
    if (!formData.name.trim()) {
      showToast(t('itemNameRequired', { item: config.itemName }), 'error');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error(tc('updateFailed'));

      showToast(t('itemUpdated', { item: config.itemName }), 'success');
      setEditingId(null);
      setIconSearchQuery('');
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('itemUpdateFailed', { item: config.itemName }), 'error');
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(t('itemDeleteConfirm', { name }))) return;

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error(tc('deleteFailed'));

      showToast(t('itemDeleted', { item: config.itemName }), 'success');
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('itemDeleteFailed', { item: config.itemName }), 'error');
    }
  };

  const setDefault = async (id: number) => {
    try {
      const res = await fetch(
        `${API_BASE_URL}/${config.endpoint}/${id}/set-default`,
        { method: 'PATCH' },
      );

      if (!res.ok) throw new Error(t('setDefaultFailed'));

      showToast(t('itemDefaultSet', { item: config.itemName }), 'success');
      fetchItems();
    } catch (e) {
      logger.error(e);
      showToast(t('itemDefaultSetFailed', { item: config.itemName }), 'error');
    }
  };

  const startEdit = (item: CategoryItem) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || '',
      color: item.color,
      icon: item.icon || '',
    });
    setIconSearchQuery('');
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      color: config.defaultColor,
      icon: '',
    });
    setIconSearchQuery('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetForm();
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || result.source.index === result.destination.index)
      return;

    const reordered = Array.from(items);
    const [moved] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, moved);

    setItems(reordered);

    const orders = reordered.map((item, index) => ({
      id: item.id,
      sortOrder: index,
    }));

    try {
      const res = await fetch(`${API_BASE_URL}/${config.endpoint}/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders }),
      });
      if (!res.ok) throw new Error(t('reorderFailed'));
    } catch (e) {
      logger.error(e);
      showToast(t('reorderFailed'), 'error');
      fetchItems();
    }
  };

  const debouncedIconSearchQuery = useDebounce(iconSearchQuery, 300);

  // NOTE: Capped at 50 to prevent rendering thousands of icon buttons at once.
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
    filteredIcons,
    debouncedIconSearchQuery,
    handleAdd,
    handleUpdate,
    handleDelete,
    setDefault,
    startEdit,
    cancelEdit,
    handleDragEnd,
  };
}
