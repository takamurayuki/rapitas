/**
 * useIdeaForm
 *
 * Owns the add/edit modal: form fields, textarea autosize, submit/edit/cancel,
 * and the "save & convert" action. Delegates list refresh to the data hook.
 */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { Idea, IdeaPriority, IdeaScope } from './idea-box.types';

interface UseIdeaFormArgs {
  /** Refetch the idea list after a mutation. / 変更後に一覧を再取得する。 */
  fetchIdeas: () => Promise<void>;
  /** Mutate the idea list for optimistic add/rollback. / 楽観的追加・ロールバック用に一覧を更新する。 */
  setIdeas: Dispatch<SetStateAction<Idea[]>>;
}

/**
 * Provide the add/edit form view model.
 *
 * @param args - Data-hook callbacks used to persist and refresh. / 永続化と再取得に使うデータフックのコールバック。
 * @returns Form state, refs, and submit/edit/cancel handlers. / フォーム状態・ref・送信/編集/キャンセルハンドラ。
 */
export function useIdeaForm({ fetchIdeas, setIdeas }: UseIdeaFormArgs) {
  const t = useTranslations('ideaBox');
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newPriority, setNewPriority] = useState<IdeaPriority>('medium');
  const [newThemeId, setNewThemeId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Bumped on every successful NEW-idea submission (not edit) so the modal's
  // lamp icon can play a one-shot "lit up" flash — see idea-create-form.tsx.
  // A counter (rather than a boolean) so back-to-back adds each get their own
  // flash: changing the value gives the icon wrapper a new React `key`,
  // forcing a remount that restarts the CSS animation from 0%.
  const [flashKey, setFlashKey] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const { themes } = useFilterDataStore();
  const { showToast } = useToast();

  const filteredThemes = themes.filter((t) => t.workingDirectory);

  // 詳細テキストエリアの高さを内容に合わせて自動調整。
  // showQuickAdd / editingId 切替時にも再計測する（編集時にプリセット内容の高さに合わせるため）。
  useEffect(() => {
    const el = contentTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [newContent, showQuickAdd, editingId]);

  useEffect(() => {
    if (showQuickAdd) titleRef.current?.focus();
  }, [showQuickAdd]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setNewTitle('');
    setNewContent('');
    setNewPriority('medium');
    setNewThemeId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!newTitle.trim()) return;

    const payload = {
      title: newTitle.trim(),
      content: newContent.trim() || newTitle.trim(),
      // 'global' skips submitIdea's default-theme fallback cascade (see
      // idea-box-service.ts) — a manual add with no theme picked must stay
      // themeless, not silently fall back to the default project theme.
      scope: (newThemeId !== null ? 'project' : 'global') as IdeaScope,
      priority: newPriority,
      themeId: newThemeId ?? null,
    };

    // Edit path keeps the simple await-then-refetch flow.
    if (editingId !== null) {
      setIsSubmitting(true);
      try {
        await fetch(`${API_BASE_URL}/idea-box/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        resetForm();
        setShowQuickAdd(false);
        await fetchIdeas();
      } catch {
        showToast(t('messages.updateFailed'), 'error');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Add path: show the idea optimistically so it appears instantly regardless
    // of request/refetch latency, then reconcile with the server in the
    // background (and roll back on failure).
    const tempId = -Date.now();
    const optimistic: Idea = {
      id: tempId,
      title: payload.title,
      content: payload.content,
      category: 'improvement',
      scope: payload.scope,
      priority: newPriority,
      tags: [],
      themeId: payload.themeId,
      source: 'user',
      usedInTaskId: null,
      createdAt: new Date().toISOString(),
    };
    setIdeas((prev) => [optimistic, ...prev]);
    resetForm();
    // Keep the modal open (cleared) so the user can add another right away.
    setTimeout(() => titleRef.current?.focus(), 0);

    try {
      // POST does not accept themeId=null, so omit it for global.
      const { themeId, ...rest } = payload;
      const body = themeId !== null ? { ...rest, themeId } : rest;
      const res = await fetch(`${API_BASE_URL}/idea-box`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchIdeas();
      setFlashKey((k) => k + 1);
    } catch {
      // Roll back the optimistic entry if the submission failed.
      setIdeas((prev) => prev.filter((i) => i.id !== tempId));
      showToast(t('messages.createFailed'), 'error');
    }
  }, [
    editingId,
    newTitle,
    newContent,
    newPriority,
    newThemeId,
    fetchIdeas,
    resetForm,
    showToast,
    setIdeas,
    t,
  ]);

  const handleEdit = useCallback((idea: Idea) => {
    setEditingId(idea.id);
    setNewTitle(idea.title);
    setNewContent(idea.content === idea.title ? '' : idea.content);
    setNewPriority(idea.priority);
    setNewThemeId(idea.themeId);
    setShowQuickAdd(true);
  }, []);

  const handleCancel = useCallback(() => {
    resetForm();
    setShowQuickAdd(false);
  }, [resetForm]);

  /** Toggle the add/edit modal from the header button (cancel if open, fresh-add if closed). */
  const handleAddClick = useCallback(() => {
    if (showQuickAdd) {
      handleCancel();
    } else {
      resetForm();
      setShowQuickAdd(true);
    }
  }, [showQuickAdd, handleCancel, resetForm]);

  /**
   * Save the open edit form AND immediately file it as a task (non-AI), so the
   * user can change fields and create the task in one action. Requires a theme
   * (workflow registration); the button is disabled without one.
   */
  const handleSaveAndConvert = useCallback(async () => {
    if (editingId === null || !newTitle.trim() || newThemeId === null) return;
    setIsSubmitting(true);
    try {
      const id = editingId;
      const title = newTitle.trim();
      const content = newContent.trim() || title;
      // Persist the edits first.
      await fetch(`${API_BASE_URL}/idea-box/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          scope: 'project',
          priority: newPriority,
          themeId: newThemeId,
        }),
      });
      // Then convert it to a task using the edited values (no AI).
      await fetch(`${API_BASE_URL}/idea-box/${id}/convert-to-task-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: content,
          priority: newPriority,
          themeId: newThemeId,
        }),
      });
      resetForm();
      setShowQuickAdd(false);
      await fetchIdeas();
    } catch {
      showToast(t('messages.convertFailed'), 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    editingId,
    newTitle,
    newContent,
    newPriority,
    newThemeId,
    fetchIdeas,
    resetForm,
    showToast,
    t,
  ]);

  return {
    showQuickAdd,
    editingId,
    newTitle,
    setNewTitle,
    newContent,
    setNewContent,
    newPriority,
    setNewPriority,
    newThemeId,
    setNewThemeId,
    isSubmitting,
    flashKey,
    filteredThemes,
    titleRef,
    contentTextareaRef,
    handleAddClick,
    handleSubmit,
    handleEdit,
    handleCancel,
    handleSaveAndConvert,
  };
}
