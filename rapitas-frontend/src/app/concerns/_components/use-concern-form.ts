/**
 * useConcernForm
 *
 * Owns the "add concern" modal: form fields (title/detail/type/severity/
 * location), the category→theme pickers, and submit. Delegates list refresh to
 * the data hook.
 */
'use client';
import { useCallback, useRef, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { type ConcernSeverity, type ConcernType } from './concern-shared';

interface UseConcernFormArgs {
  /** Refetch the concern list after a successful create. / 登録成功後に一覧を再取得する。 */
  fetchConcerns: () => Promise<void>;
}

/**
 * Provide the add-concern form view model.
 *
 * @param args - Data-hook callback used to refresh the list. / 一覧再取得に使うデータフックのコールバック。
 * @returns Form state, refs, the category-change handler, and submit/close
 *   handlers. / フォーム状態・ref・カテゴリ変更ハンドラと送信/閉じるハンドラ。
 */
export function useConcernForm({ fetchConcerns }: UseConcernFormArgs) {
  const [showAdd, setShowAdd] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newDetail, setNewDetail] = useState('');
  const [newType, setNewType] = useState<ConcernType>('bug');
  const [newSeverity, setNewSeverity] = useState<ConcernSeverity>('medium');
  const [newLocation, setNewLocation] = useState('');
  // Concerns are always about a specific project — no "global" scope; pick
  // category (to narrow themes) then theme. Only themeId is persisted.
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
  const [newThemeId, setNewThemeId] = useState<number | null>(null);

  const { categories, themes } = useFilterDataStore();
  const { showToast } = useToast();
  // Only themes with a working directory are valid targets (shared idea-box rule).
  const workingDirThemes = themes.filter((t) => t.workingDirectory);
  const filteredThemes = newCategoryId
    ? workingDirThemes.filter((t) => t.categoryId === newCategoryId)
    : workingDirThemes;

  const resetForm = useCallback(() => {
    setNewTitle('');
    setNewDetail('');
    setNewType('bug');
    setNewSeverity('medium');
    setNewLocation('');
    setNewCategoryId(null);
    setNewThemeId(null);
  }, []);

  /** Toggle the add-concern modal (header "+" button). */
  const toggleAdd = useCallback(() => setShowAdd((v) => !v), []);

  /** Close the add-concern modal and clear the in-progress form. */
  const closeAdd = useCallback(() => {
    resetForm();
    setShowAdd(false);
  }, [resetForm]);

  /** Pick a category in the add form and clear the dependent theme selection. */
  const handleNewCategoryChange = useCallback((id: number | null) => {
    setNewCategoryId(id);
    setNewThemeId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!newTitle.trim() || !newDetail.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/concerns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          detail: newDetail.trim(),
          type: newType,
          severity: newSeverity,
          location: newLocation.trim() || undefined,
          themeId: newThemeId ?? undefined,
        }),
      });
      if (!res.ok) {
        showToast('懸念の登録に失敗しました', 'error');
        return;
      }
      resetForm();
      // Keep the modal open (cleared) so the user can file another right away.
      setTimeout(() => titleRef.current?.focus(), 0);
      await fetchConcerns();
    } catch {
      showToast('懸念の登録に失敗しました', 'error');
    }
  }, [
    newTitle,
    newDetail,
    newType,
    newSeverity,
    newLocation,
    newThemeId,
    fetchConcerns,
    resetForm,
    showToast,
  ]);

  return {
    showAdd,
    toggleAdd,
    closeAdd,
    titleRef,
    newTitle,
    setNewTitle,
    newDetail,
    setNewDetail,
    newType,
    setNewType,
    newSeverity,
    setNewSeverity,
    newLocation,
    setNewLocation,
    newCategoryId,
    handleNewCategoryChange,
    newThemeId,
    setNewThemeId,
    categories,
    filteredThemes,
    handleSubmit,
  };
}
