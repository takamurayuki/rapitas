/**
 * useIdeaConvert
 *
 * Owns the non-AI "convert idea to task" flow, including the theme-picker modal
 * required for theme-less (global) ideas. Delegates list refresh to the data hook.
 */
'use client';
import { useCallback, useState } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import type { Idea } from './idea-box.types';

interface UseIdeaConvertArgs {
  /** Refetch the idea list after a conversion. / 変換後に一覧を再取得する。 */
  fetchIdeas: () => Promise<void>;
}

/**
 * Provide the idea-to-task conversion view model.
 *
 * @param args - Data-hook callbacks used to refresh after conversion. / 変換後の再取得に使うデータフックのコールバック。
 * @returns Conversion state, the theme-picker state, and their handlers. / 変換状態・テーマ選択状態とそのハンドラ。
 */
export function useIdeaConvert({ fetchIdeas }: UseIdeaConvertArgs) {
  const { categories, themes } = useFilterDataStore();

  // タスク変換関連のstate
  const [convertingIdeaId, setConvertingIdeaId] = useState<number | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // テーマ未設定アイデアのタスク化前テーマ選択モーダル状態
  // NOTE: グローバルアイデア（テーマ未設定）はそのままタスク化するとワークフローで起票できないため、必ずテーマを選ばせる。
  const [themePickerIdea, setThemePickerIdea] = useState<Idea | null>(null);
  const [themePickerCategoryId, setThemePickerCategoryId] = useState<number | null>(null);
  const [themePickerThemeId, setThemePickerThemeId] = useState<number | null>(null);
  const themePickerThemes = themePickerCategoryId
    ? themes.filter((t) => t.workingDirectory && t.categoryId === themePickerCategoryId)
    : themes.filter((t) => t.workingDirectory);

  /**
   * Convert an idea straight to a task WITHOUT AI, using the idea's own
   * title/content/priority (the manual conversion endpoint). Immediate — no
   * field-editing modal.
   */
  const executeQuickConvert = useCallback(
    async (idea: Idea, themeId: number) => {
      setConvertingIdeaId(idea.id);
      setIsConverting(true);

      try {
        const response = await fetch(`${API_BASE_URL}/idea-box/${idea.id}/convert-to-task-manual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: idea.title,
            description: idea.content,
            priority: idea.priority,
            themeId,
          }),
        });

        if (response.ok) {
          await fetchIdeas();
        } else {
          console.error('Failed to convert idea to task');
        }
      } catch (error) {
        console.error('Error converting idea to task:', error);
      } finally {
        setConvertingIdeaId(null);
        setIsConverting(false);
      }
    },
    [fetchIdeas],
  );

  const handleConvertToTask = useCallback(
    (idea: Idea) => {
      // A theme is required for workflow registration; global (theme-less) ideas
      // still need one, so pick it first — but the conversion stays non-AI.
      if (idea.themeId === null) {
        setThemePickerIdea(idea);
        setThemePickerCategoryId(null);
        setThemePickerThemeId(null);
        return;
      }
      void executeQuickConvert(idea, idea.themeId);
    },
    [executeQuickConvert],
  );

  const closeThemePicker = useCallback(() => {
    setThemePickerIdea(null);
    setThemePickerCategoryId(null);
    setThemePickerThemeId(null);
  }, []);

  /** Pick a category in the theme-picker modal and clear the dependent theme selection. */
  const handleThemePickerCategoryChange = useCallback((id: number | null) => {
    setThemePickerCategoryId(id);
    setThemePickerThemeId(null);
  }, []);

  const submitThemePicker = useCallback(async () => {
    if (!themePickerIdea || themePickerThemeId === null) return;
    const idea = themePickerIdea;
    const themeId = themePickerThemeId;
    closeThemePicker();
    await executeQuickConvert(idea, themeId);
  }, [themePickerIdea, themePickerThemeId, executeQuickConvert, closeThemePicker]);

  return {
    categories,
    isConverting,
    convertingIdeaId,
    handleConvertToTask,
    themePickerIdea,
    themePickerCategoryId,
    handleThemePickerCategoryChange,
    themePickerThemeId,
    setThemePickerThemeId,
    themePickerThemes,
    closeThemePicker,
    submitThemePicker,
  };
}
