/**
 * useIdeaData
 *
 * Owns the idea list itself: fetching, filters, pagination, search-derived
 * views, and list mutations (delete). Holds no form or conversion state.
 */
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useLocalStorageState } from '@/hooks/common/useLocalStorageState';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { Idea, IdeaPriority, IdeaStats, IdeaStatusFilter } from './idea-box.types';

// Stale-while-revalidate cache for the list. The page previously always
// started from a skeleton and only fetched after hydration (~0.5-2s perceived
// on every visit); with this, a revisit paints the previous result instantly
// and reconciles with the server in the background.
const LIST_CACHE_KEY = 'ideaBox.list-cache.v1';

interface IdeaListCache {
  signature: string;
  ideas: Idea[];
  total: number;
  stats: IdeaStats | null;
}

function readListCache(): IdeaListCache | null {
  try {
    const raw = sessionStorage.getItem(LIST_CACHE_KEY);
    return raw ? (JSON.parse(raw) as IdeaListCache) : null;
  } catch {
    return null;
  }
}

function writeListCache(cache: IdeaListCache): void {
  try {
    sessionStorage.setItem(LIST_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota/priv mode — cache is best-effort */
  }
}

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
  // Mirrors `ideas.length > 0` for callbacks that must not re-create on data
  // changes (fetchIdeas reads it to decide whether a skeleton is needed).
  const hasDataRef = useRef(false);

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

  // Everything that changes what the server returns, in one string — the cache
  // is only replayed when the view it was captured for is the view requested.
  const querySignature = JSON.stringify({
    filterThemeId,
    statusFilter,
    priorityFilter,
    currentPage,
    itemsPerPage,
  });

  const fetchIdeas = useCallback(async () => {
    // Stale-while-revalidate: keep showing what we have while refreshing.
    // The skeleton only appears when there is genuinely nothing to show.
    if (!hasDataRef.current) setIsLoading(true);
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

      let nextIdeas: Idea[] | null = null;
      let nextTotal = 0;
      if (ideasRes.ok) {
        const data = (await ideasRes.json()) as { ideas: Idea[]; total: number };
        nextIdeas = data.ideas;
        nextTotal = data.total;
        setIdeas(data.ideas);
        setTotalIdeas(data.total);
        setTotalPages(Math.ceil(data.total / itemsPerPage));
        hasDataRef.current = data.ideas.length > 0;
      }
      let nextStats: IdeaStats | null = null;
      if (statsRes.ok) {
        nextStats = (await statsRes.json()) as IdeaStats;
        setStats(nextStats);
      }
      if (nextIdeas) {
        writeListCache({
          signature: querySignature,
          ideas: nextIdeas,
          total: nextTotal,
          stats: nextStats,
        });
      }
    } catch {
      /* non-critical */
    } finally {
      setIsLoading(false);
    }
  }, [filterThemeId, statusFilter, priorityFilter, currentPage, itemsPerPage, querySignature]);

  // Replay the cached list before the first fetch resolves so a revisit paints
  // instantly. Runs once on mount; the in-flight fetch then reconciles.
  useEffect(() => {
    const cached = readListCache();
    if (cached && cached.signature === querySignature && cached.ideas.length > 0) {
      setIdeas(cached.ideas);
      setTotalIdeas(cached.total);
      setTotalPages(Math.ceil(cached.total / itemsPerPage));
      if (cached.stats) setStats(cached.stats);
      hasDataRef.current = true;
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only replay
  }, []);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  // 検索語変更時のページリセット。フィルタ変更は下のラップ済みセッターが同一
  // バッチでリセットするため、ここで購読すると「旧ページ×新フィルタ」の無駄な
  // フェッチが1回挟まる — searchQuery(外部由来)のみを見る。
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Reset to page 1 in the SAME render batch as the filter change — one fetch,
  // not a wasted "old page with new filter" round-trip first.
  const setStatusFilterAndReset = useCallback<typeof setStatusFilter>((v) => {
    setStatusFilter(v);
    setCurrentPage(1);
  }, []);
  const setPriorityFilterAndReset = useCallback<typeof setPriorityFilter>((v) => {
    setPriorityFilter(v);
    setCurrentPage(1);
  }, []);
  const setFilterThemeIdAndReset = useCallback<typeof setFilterThemeId>((v) => {
    setFilterThemeId(v);
    setCurrentPage(1);
  }, []);

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
    setStatusFilter: setStatusFilterAndReset,
    priorityFilter,
    setPriorityFilter: setPriorityFilterAndReset,
    filterThemeId,
    setFilterThemeId: setFilterThemeIdAndReset,
    filterThemes,
    handleDelete,
  };
}
