/**
 * useIdeaData
 *
 * Owns the idea list itself: fetching, filters, pagination, search-derived
 * views, and list mutations (delete). Holds no form or conversion state.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocalStorageState } from '@/hooks/common/useLocalStorageState';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { Idea, IdeaPriority, IdeaStats, IdeaStatusFilter } from './idea-box.types';

/**
 * Provide the idea list view model.
 *
 * @returns List data, filter/pagination state, and the delete handler. / 一覧データ・フィルタ/ページネーション状態・削除ハンドラ。
 */
export function useIdeaData() {
  const t = useTranslations('ideaBox');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [stats, setStats] = useState<IdeaStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ページネーション状態
  const [currentPage, setCurrentPage] = useState(1);
  // Default 10 per page to match the task list pagination.
  const [itemsPerPage, setItemsPerPage] = useLocalStorageState('ideaBox.itemsPerPage', 10);
  const [totalPages, setTotalPages] = useState(0);
  const [totalIdeas, setTotalIdeas] = useState(0);

  const [filterThemeId, setFilterThemeId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<IdeaStatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | IdeaPriority>('all');
  const searchParams = useSearchParams();
  const searchQuery = searchParams?.get('search')?.trim() ?? '';

  const { themes } = useFilterDataStore();
  const { showToast } = useToast();
  // Ideas are turned into tasks that run in a theme's repo, so theme pulldowns
  // only offer themes that have a working directory set. (Shared rule with the
  // concern backlog.) Theme-name display still uses the full `themes` list.
  const filterThemes = themes.filter((t) => t.workingDirectory);

  const fetchIdeas = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      // NOTE: themeIdフィルタリングもサーバーサイドで処理するため追加
      if (filterThemeId) params.set('themeId', String(filterThemeId));
      // 未分類タブ = テーマ未設定 (scope: global) のアイデア。ライフサイクル状態では
      // ないので status ではなく scope フィルタとしてサーバーへ渡す。
      if (statusFilter === 'uncategorized') params.set('scope', 'global');
      else if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);

      const [ideasRes, statsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/idea-box?${params}`),
        fetch(`${API_BASE_URL}/idea-box/stats`),
      ]);

      if (ideasRes.ok) {
        const data = (await ideasRes.json()) as { ideas: Idea[]; total: number };
        setIdeas(data.ideas);
        setTotalIdeas(data.total);
        setTotalPages(Math.ceil(data.total / itemsPerPage));
      }
      if (statsRes.ok) setStats((await statsRes.json()) as IdeaStats);
    } catch {
      /* non-critical */
    } finally {
      setIsLoading(false);
    }
  }, [filterThemeId, statusFilter, priorityFilter, currentPage, itemsPerPage]);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  // フィルタ変更時のページリセット
  useEffect(() => {
    setCurrentPage(1);
  }, [filterThemeId, statusFilter, priorityFilter, searchQuery]);

  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleItemsPerPageChange = useCallback(
    (count: number) => {
      setItemsPerPage(count);
      setCurrentPage(1);
    },
    [setItemsPerPage],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/idea-box/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          showToast(t('messages.deleteFailed'), 'error');
          return;
        }
        // 楽観的に即削除して反応を即時化
        setIdeas((prev) => prev.filter((i) => i.id !== id));
        // 削除後ページが空になる場合は1ページ戻す（戻した先で fetchIdeas が走る）
        // それ以外は同じページで再取得し、次ページから1件繰り上げて itemsPerPage 件を保つ
        if (ideas.length - 1 === 0 && currentPage > 1) {
          setCurrentPage((p) => p - 1);
        } else {
          await fetchIdeas();
        }
      } catch {
        showToast(t('messages.deleteFailed'), 'error');
      }
    },
    [ideas.length, currentPage, fetchIdeas, showToast, t],
  );

  // NOTE: filterThemeIdはサーバーサイドで処理されるため、クライアント側ではsearchQueryのみフィルタリング
  const filtered = ideas.filter((idea) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return idea.title.toLowerCase().includes(q) || idea.content.toLowerCase().includes(q);
    }
    return true;
  });

  // 検索がある場合はクライアント側フィルタリング結果、ない場合はサーバーサイドの総数を使用
  const displayTotalIdeas = searchQuery ? filtered.length : totalIdeas;

  // 検索時のページング処理: クライアントサイドでページング
  const paginatedFiltered = searchQuery
    ? filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
    : filtered;

  // 動的ページ数計算: 検索時とフィルタ時で異なるtotal値を使用
  const dynamicTotalPages = searchQuery ? Math.ceil(filtered.length / itemsPerPage) : totalPages;

  return {
    setIdeas,
    fetchIdeas,
    stats,
    isLoading,
    themes,
    filtered,
    paginatedFiltered,
    displayTotalIdeas,
    searchQuery,
    currentPage,
    itemsPerPage,
    dynamicTotalPages,
    handlePageChange,
    handleItemsPerPageChange,
    statusFilter,
    setStatusFilter,
    priorityFilter,
    setPriorityFilter,
    filterThemeId,
    setFilterThemeId,
    filterThemes,
    handleDelete,
  };
}
