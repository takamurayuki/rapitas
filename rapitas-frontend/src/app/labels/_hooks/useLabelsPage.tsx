/**
 * useLabelsPage
 *
 * State and CRUD logic for the labels management page.
 * Labels are scoped per CATEGORY (2026-07 migration): Category → Labels.
 * Also owns icon-picker state (mirrors useThemesPage pattern).
 */
'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Tag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { searchIcons, getIconComponent } from '@/components/category/icon-data';
import { useDebounce } from '@/hooks/common/useDebounce';
import type { Category } from '@/types';

export interface LabelItem {
  id: number;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  sortOrder: number;
  categoryId: number | null;
  category: { id: number; name: string; color: string; icon: string | null } | null;
  _count: { tasks: number };
}

export interface LabelFormData {
  name: string;
  description: string;
  color: string;
  icon: string;
  categoryId: number | null;
}

export const defaultFormData: LabelFormData = {
  name: '',
  description: '',
  color: '#6366F1',
  icon: 'Tag',
  categoryId: null,
};

/** Pick the default item (isDefault=true) or fall back to the first item. */
function pickDefault<T extends { id: number; isDefault?: boolean }>(items: T[]): number | null {
  if (items.length === 0) return null;
  const def = items.find((i) => i.isDefault);
  return (def ?? items[0]).id;
}

export function useLabelsPage() {
  const t = useTranslations('labels');
  const confirm = useConfirmDialog();
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<LabelFormData>(defaultFormData);

  // Icon picker
  const [iconSearchQuery, setIconSearchQuery] = useState('');
  const debouncedIconSearchQuery = useDebounce(iconSearchQuery, 300);

  // NOTE: Capped at 50 to match the theme form's icon limit.
  const filteredIcons = useMemo(
    () => searchIcons(debouncedIconSearchQuery).slice(0, 50),
    [debouncedIconSearchQuery],
  );

  const renderIcon = useCallback((iconName: string | null | undefined, size = 16) => {
    const IconComponent = getIconComponent(iconName ?? '');
    if (IconComponent) return <IconComponent size={size} />;
    return <Tag size={size} />;
  }, []);

  // ── fetch ─────────────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [labelsRes, categoriesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/labels`),
        fetch(`${API_BASE_URL}/categories`),
      ]);
      const [labelsData, categoriesData] = await Promise.all([
        labelsRes.ok ? labelsRes.json() : [],
        categoriesRes.ok ? categoriesRes.json() : [],
      ]);
      setLabels(labelsData);
      setCategories(categoriesData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-select default (or first) category once categories load.
  useEffect(() => {
    if (categories.length > 0 && selectedCategoryId === null) {
      setSelectedCategoryId(pickDefault(categories));
    }
  }, [categories, selectedCategoryId]);

  // ── derived ───────────────────────────────────────────────────────────────

  /** Labels belonging to the currently selected category. */
  const filteredLabels =
    selectedCategoryId != null ? labels.filter((l) => l.categoryId === selectedCategoryId) : labels;

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const handleAdd = useCallback(async () => {
    if (!formData.name.trim()) return;
    const res = await fetch(`${API_BASE_URL}/labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.name.trim(),
        description: formData.description || undefined,
        color: formData.color,
        icon: formData.icon || undefined,
        categoryId: formData.categoryId,
      }),
    });
    if (res.ok) {
      setIsAdding(false);
      setFormData(defaultFormData);
      await fetchAll();
    }
  }, [formData, fetchAll]);

  const handleUpdate = useCallback(
    async (id: number) => {
      const res = await fetch(`${API_BASE_URL}/labels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description || undefined,
          color: formData.color,
          icon: formData.icon || undefined,
          categoryId: formData.categoryId,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        setFormData(defaultFormData);
        await fetchAll();
      }
    },
    [formData, fetchAll],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      if (!(await confirm({ message: t('list.deleteConfirm'), variant: 'destructive' }))) return;
      const res = await fetch(`${API_BASE_URL}/labels/${id}`, { method: 'DELETE' });
      if (res.ok) await fetchAll();
    },
    [fetchAll, confirm, t],
  );

  const startEdit = useCallback((label: LabelItem) => {
    setEditingId(label.id);
    setIsAdding(false);
    setIconSearchQuery('');
    setFormData({
      name: label.name,
      description: label.description ?? '',
      color: label.color,
      icon: label.icon ?? 'Tag',
      categoryId: label.categoryId,
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setIsAdding(false);
    setIconSearchQuery('');
    setFormData(defaultFormData);
  }, []);

  const selectCategory = useCallback(
    (id: number) => {
      setSelectedCategoryId(id);
      cancelEdit();
    },
    [cancelEdit],
  );

  return {
    labels,
    categories,
    filteredLabels,
    loading,
    selectedCategoryId,
    editingId,
    isAdding,
    setIsAdding,
    formData,
    setFormData,
    iconSearchQuery,
    setIconSearchQuery,
    filteredIcons,
    debouncedIconSearchQuery,
    renderIcon,
    fetchAll,
    handleAdd,
    handleUpdate,
    handleDelete,
    startEdit,
    cancelEdit,
    selectCategory,
  };
}
