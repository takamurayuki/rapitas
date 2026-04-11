/**
 * useThemesPage
 *
 * Top-level hook for the Themes management page. Composes useDirectoryStatus
 * and useThemeCrud, and owns only the high-level page state (item list,
 * categories, form, icon search). Does not contain UI rendering.
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast/ToastContainer';
import {
  searchIcons,
  getIconComponent,
  ICON_DATA,
} from '@/components/category/icon-data';
import { SwatchBook } from 'lucide-react';
import type { Theme, Category } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { useDebounce } from '@/hooks/common/useDebounce';
import { createLogger } from '@/lib/logger';
import type { DropResult } from '@hello-pangea/dnd';
import { useDirectoryStatus } from './useDirectoryStatus';
import { useThemeCrud } from './useThemeCrud';

const logger = createLogger('ThemesPage');

export type FormData = {
  name: string;
  description: string;
  color: string;
  icon: string;
  isDevelopment: boolean;
  repositoryUrl: string;
  workingDirectory: string;
  defaultBranch: string;
  categoryId: number | null;
};

export const defaultFormData: FormData = {
  name: '',
  description: '',
  color: '#8B5CF6',
  icon: '',
  isDevelopment: false,
  repositoryUrl: '',
  workingDirectory: '',
  defaultBranch: 'develop',
  categoryId: null,
};

/**
 * Composing hook for the Themes page — owns item list, categories, form state,
 * and icon search. Delegates directory/branch logic and CRUD operations to
 * sub-hooks.
 *
 * @returns All state values, derived data, and action handlers needed by the page UI.
 */
export function useThemesPage() {
  const t = useTranslations('themes');
  const tc = useTranslations('common');
  const { showToast } = useToast();

  const [items, setItems] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [iconSearchQuery, setIconSearchQuery] = useState('');
  const [formData, setFormData] = useState<FormData>(defaultFormData);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [initialCategorySet, setInitialCategorySet] = useState(false);

  // NOTE: Refs used as stable accessors passed to sub-hooks so they always
  // read the latest values without causing re-renders in consumers.
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const editingIdRef = useRef(editingId);
  editingIdRef.current = editingId;

  const setFormDataFunctional = (updater: (prev: FormData) => FormData) =>
    setFormData((prev) => updater(prev));

  const dir = useDirectoryStatus(
    () => formDataRef.current,
    setFormDataFunctional,
    () => editingIdRef.current,
  );

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/themes`);
      if (!res.ok) throw new Error(tc('fetchFailed'));
      setItems(await res.json());
    } catch (e) {
      logger.error(e);
      showToast(t('fetchFailed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const crud = useThemeCrud({
    getFormData: () => formDataRef.current,
    fetchItems,
  });

  const seedDefaults = async () => {
    try {
      await fetch(`${API_BASE_URL}/categories/seed-defaults`, {
        method: 'POST',
      });
    } catch (e) {
      logger.error('Failed to seed default categories:', e);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data);
        if (data.length > 0) {
          if (!initialCategorySet) {
            setSelectedCategoryId(data[0].id);
            setInitialCategorySet(true);
          }
          setFormData((prev) => ({
            ...prev,
            categoryId: prev.categoryId ?? data[0].id,
          }));
        }
      }
    } catch (e) {
      logger.error(e);
    }
  };

  useEffect(() => {
    seedDefaults().then(() => {
      fetchItems();
      fetchCategories();
    });
    // NOTE: Empty deps — runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = (item: Theme) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      description: item.description || '',
      color: item.color,
      icon: item.icon || '',
      isDevelopment: item.isDevelopment || false,
      repositoryUrl: item.repositoryUrl || '',
      workingDirectory: item.workingDirectory || '',
      defaultBranch: item.defaultBranch || 'develop',
      categoryId: item.categoryId ?? null,
    });
    setIconSearchQuery('');

    if (item.isDevelopment && item.workingDirectory) {
      dir.checkDirectory(item.workingDirectory);
    } else {
      dir.resetDirectoryState();
    }

    if (item.isDevelopment && item.repositoryUrl) {
      dir.fetchBranches(item.repositoryUrl);
    } else {
      dir.setBranches([]);
      dir.setBranchError(null);
    }
  };

  const resetForm = () => {
    setFormData(defaultFormData);
    setIconSearchQuery('');
    dir.resetDirectoryState();
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsAdding(false);
    resetForm();
  };

  const handleAdd = () =>
    crud.handleAdd(() => {
      setIsAdding(false);
      resetForm();
    });

  const handleUpdate = (id: number) =>
    crud.handleUpdate(id, () => {
      setEditingId(null);
      setIconSearchQuery('');
    });

  const handleDragEnd = (result: DropResult) =>
    crud.handleDragEnd(result, items, setItems);

  const debouncedIconSearchQuery = useDebounce(iconSearchQuery, 300);

  // NOTE: Capped at 50 to prevent rendering lag with the full icon set (~1000 icons).
  const filteredIcons = useMemo(() => {
    const results = searchIcons(debouncedIconSearchQuery);
    return results.slice(0, 50);
  }, [debouncedIconSearchQuery]);

  /**
   * Renders a Lucide icon by name, falling back to SwatchBook.
   *
   * @param iconName - The icon key from IconData / Lucide icon name.
   * @param size - Pixel size passed to the icon component. / アイコンのピクセルサイズ
   * @returns JSX element for the icon.
   */
  const renderIcon = (iconName: string | null | undefined, size = 20) => {
    const IconComponent = getIconComponent(iconName || '');
    if (IconComponent) return <IconComponent size={size} />;

    const DefaultIcon =
      getIconComponent('SwatchBook') ??
      ICON_DATA?.['SwatchBook']?.component ??
      SwatchBook;

    return <DefaultIcon size={size} />;
  };

  return {
    // Page state
    items,
    loading,
    editingId,
    isAdding,
    setIsAdding,
    iconSearchQuery,
    setIconSearchQuery,
    formData,
    setFormData,
    categories,
    selectedCategoryId,
    setSelectedCategoryId,
    // Directory / branch state (from useDirectoryStatus)
    ...dir,
    // Derived
    filteredIcons,
    debouncedIconSearchQuery,
    // CRUD actions
    handleAdd,
    handleUpdate,
    handleDelete: crud.handleDelete,
    setDefault: crud.setDefault,
    // Local actions
    startEdit,
    cancelEdit,
    resetForm,
    handleDragEnd,
    renderIcon,
  };
}
