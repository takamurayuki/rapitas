'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocalStorageState } from '@/hooks/common/useLocalStorageState';
import {
  Lightbulb,
  Loader2,
  Globe,
  FolderOpen,
  Sparkles,
  Bot,
  MessageSquare,
  User,
  Trash2,
  Pencil,
  ArrowRight,
  ListPlus,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import { getIconComponent } from '@/components/category/icon-data';
import { IdeaBoxHeader } from './IdeaBoxHeader';
import Pagination from '@/components/ui/pagination/Pagination';

type IdeaScope = 'global' | 'project';

interface Idea {
  id: number;
  title: string;
  content: string;
  category: string;
  scope: IdeaScope;
  tags: string[];
  themeId: number | null;
  source: string;
  usedInTaskId: number | null;
  createdAt: string;
}

interface IdeaStats {
  total: number;
  unused: number;
}

const SOURCE_ICONS: Record<string, typeof User> = {
  user: User,
  agent_execution: Bot,
  copilot: MessageSquare,
  code_review: Sparkles,
};

export default function IdeasClient() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [stats, setStats] = useState<IdeaStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ページネーション状態
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useLocalStorageState('ideaBox.itemsPerPage', 15);
  const [totalPages, setTotalPages] = useState(0);
  const [totalIdeas, setTotalIdeas] = useState(0);

  const [scopeFilter, setScopeFilter] = useState<IdeaScope | 'all'>('all');
  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [filterThemeId, setFilterThemeId] = useState<number | null>(null);
  const searchParams = useSearchParams();
  const searchQuery = searchParams?.get('search')?.trim() ?? '';
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newScope, setNewScope] = useState<IdeaScope>('global');
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
  const [newThemeId, setNewThemeId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const { categories, themes } = useFilterDataStore();

  // 詳細テキストエリアの高さを内容に合わせて自動調整。
  // showQuickAdd / editingId 切替時にも再計測する（編集時にプリセット内容の高さに合わせるため）。
  useEffect(() => {
    const el = contentTextareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [newContent, showQuickAdd, editingId]);

  // タスク変換関連のstate
  const [convertingIdeaId, setConvertingIdeaId] = useState<number | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // 手動タスク化モーダル状態
  const [manualConvertIdea, setManualConvertIdea] = useState<Idea | null>(null);
  const [manualTitle, setManualTitle] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [manualPriority, setManualPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>(
    'medium',
  );
  const [manualEstimatedHours, setManualEstimatedHours] = useState<string>('');
  const [manualThemeId, setManualThemeId] = useState<number | null>(null);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);

  // テーマ未設定アイデアの AI タスク化前テーマ選択モーダル状態
  // NOTE: グローバルアイデア（テーマ未設定）はそのままタスク化するとワークフローで起票できないため、必ずテーマを選ばせる。
  const [themePickerIdea, setThemePickerIdea] = useState<Idea | null>(null);
  const [themePickerCategoryId, setThemePickerCategoryId] = useState<number | null>(null);
  const [themePickerThemeId, setThemePickerThemeId] = useState<number | null>(null);
  const themePickerThemes = themePickerCategoryId
    ? themes.filter((t) => t.categoryId === themePickerCategoryId)
    : themes;

  const filteredThemes = newCategoryId
    ? themes.filter((t) => t.categoryId === newCategoryId)
    : themes;

  const filterThemes = filterCategoryId
    ? themes.filter((t) => t.categoryId === filterCategoryId)
    : themes;

  const fetchIdeas = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      if (scopeFilter !== 'all') params.set('scope', scopeFilter);
      if (filterCategoryId) params.set('categoryId', String(filterCategoryId));
      // NOTE: themeIdフィルタリングもサーバーサイドで処理するため追加
      if (filterThemeId) params.set('themeId', String(filterThemeId));

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
  }, [scopeFilter, filterCategoryId, filterThemeId, currentPage, itemsPerPage]);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  // フィルタ変更時のページリセット
  useEffect(() => {
    setCurrentPage(1);
  }, [scopeFilter, filterCategoryId, filterThemeId, searchQuery]);

  // ページネーションハンドラー
  const handlePageChange = useCallback((page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleItemsPerPageChange = useCallback((count: number) => {
    setItemsPerPage(count);
    setCurrentPage(1);
  }, []);

  useEffect(() => {
    if (showQuickAdd) titleRef.current?.focus();
  }, [showQuickAdd]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setNewTitle('');
    setNewContent('');
    setNewScope('global');
    setNewCategoryId(null);
    setNewThemeId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!newTitle.trim()) return;
    setIsSubmitting(true);
    try {
      const payload = {
        title: newTitle.trim(),
        content: newContent.trim() || newTitle.trim(),
        scope: newScope,
        // Send null for global scope so PATCH clears any prior themeId.
        themeId: newScope === 'project' ? (newThemeId ?? null) : null,
      };
      if (editingId !== null) {
        await fetch(`${API_BASE_URL}/idea-box/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        // POST does not accept themeId=null, so omit it for global.
        const { themeId, ...rest } = payload;
        const body = themeId !== null ? { ...rest, themeId } : rest;
        await fetch(`${API_BASE_URL}/idea-box`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      resetForm();
      setShowQuickAdd(false);
      await fetchIdeas();
    } catch {
      /* error */
    } finally {
      setIsSubmitting(false);
    }
  }, [editingId, newTitle, newContent, newScope, newThemeId, fetchIdeas, resetForm]);

  const handleEdit = useCallback(
    (idea: Idea) => {
      setEditingId(idea.id);
      setNewTitle(idea.title);
      setNewContent(idea.content === idea.title ? '' : idea.content);
      setNewScope(idea.scope);
      const theme = themes.find((t) => t.id === idea.themeId);
      setNewCategoryId(theme?.categoryId ?? null);
      setNewThemeId(idea.themeId);
      setShowQuickAdd(true);
    },
    [themes],
  );

  const handleCancel = useCallback(() => {
    resetForm();
    setShowQuickAdd(false);
  }, [resetForm]);

  const handleDelete = useCallback(async (id: number) => {
    try {
      await fetch(`${API_BASE_URL}/idea-box/${id}`, { method: 'DELETE' });
      setIdeas((prev) => prev.filter((i) => i.id !== id));
    } catch {
      /* non-critical */
    }
  }, []);

  const executeAiConvert = useCallback(
    async (idea: Idea, themeId: number) => {
      setConvertingIdeaId(idea.id);
      setIsConverting(true);

      try {
        const response = await fetch(`${API_BASE_URL}/idea-box/${idea.id}/convert-to-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ themeId }),
        });

        if (response.ok) {
          const result = await response.json();
          console.log('Task created:', result);
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
      // テーマが無いアイデアはそのまま起票するとワークフローで利用できないため、テーマ選択モーダルを挟む。
      if (idea.themeId === null) {
        setThemePickerIdea(idea);
        setThemePickerCategoryId(null);
        setThemePickerThemeId(null);
        return;
      }
      void executeAiConvert(idea, idea.themeId);
    },
    [executeAiConvert],
  );

  const closeThemePicker = useCallback(() => {
    setThemePickerIdea(null);
    setThemePickerCategoryId(null);
    setThemePickerThemeId(null);
  }, []);

  const submitThemePicker = useCallback(async () => {
    if (!themePickerIdea || themePickerThemeId === null) return;
    const idea = themePickerIdea;
    const themeId = themePickerThemeId;
    closeThemePicker();
    await executeAiConvert(idea, themeId);
  }, [themePickerIdea, themePickerThemeId, executeAiConvert, closeThemePicker]);

  /**
   * Open the manual-convert modal pre-filled with the idea's title and
   * content. The user can edit fields before submitting; AI is NOT used.
   */
  const openManualConvert = useCallback((idea: Idea) => {
    setManualConvertIdea(idea);
    setManualTitle(idea.title);
    setManualDescription(idea.content);
    setManualPriority('medium');
    setManualEstimatedHours('');
    setManualThemeId(idea.themeId);
    setManualError(null);
  }, []);

  const closeManualConvert = useCallback(() => {
    setManualConvertIdea(null);
    setManualError(null);
    setIsManualSubmitting(false);
  }, []);

  const submitManualConvert = useCallback(async () => {
    if (!manualConvertIdea) return;
    if (!manualTitle.trim()) {
      setManualError('タイトルは必須です');
      return;
    }
    if (manualThemeId === null) {
      // テーマ未設定だとワークフロー登録ができないため必須化。
      setManualError('テーマを選択してください');
      return;
    }
    setIsManualSubmitting(true);
    setManualError(null);
    try {
      const hoursNum = manualEstimatedHours.trim() ? Number(manualEstimatedHours) : undefined;
      const res = await fetch(
        `${API_BASE_URL}/idea-box/${manualConvertIdea.id}/convert-to-task-manual`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: manualTitle.trim(),
            description: manualDescription,
            priority: manualPriority,
            ...(typeof hoursNum === 'number' && !Number.isNaN(hoursNum) && hoursNum >= 0
              ? { estimatedHours: hoursNum }
              : {}),
            ...(manualThemeId !== null ? { themeId: manualThemeId } : {}),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setManualError(data.error || `HTTP ${res.status}`);
        return;
      }
      await fetchIdeas();
      closeManualConvert();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : '送信に失敗しました');
    } finally {
      setIsManualSubmitting(false);
    }
  }, [
    manualConvertIdea,
    manualTitle,
    manualDescription,
    manualPriority,
    manualEstimatedHours,
    manualThemeId,
    fetchIdeas,
    closeManualConvert,
  ]);

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

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-3 sm:px-4 md:px-6 py-4">
        <IdeaBoxHeader
          totalIdeas={displayTotalIdeas}
          onAddClick={() => {
            if (showQuickAdd) {
              handleCancel();
            } else {
              resetForm();
              setShowQuickAdd(true);
            }
          }}
        />

        {/* Quick Add — inline card that appears at the top */}
        {showQuickAdd && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/20">
            <div className="space-y-3">
              <input
                ref={titleRef}
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim()) handleSubmit();
                  if (e.key === 'Escape') handleCancel();
                }}
                placeholder="💡 アイデアをひとことで..."
                className="w-full rounded-lg border-0 bg-white px-4 py-3 text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-zinc-800 dark:placeholder:text-zinc-500"
              />
              <textarea
                ref={contentTextareaRef}
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="詳細（任意）"
                className="w-full rounded-lg border-0 bg-white px-4 py-2.5 text-xs shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-zinc-800 dark:placeholder:text-zinc-500 resize-none overflow-hidden min-h-[3rem] max-h-[60vh]"
                style={{ overflowY: 'auto' }}
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {/* Scope toggle */}
                  <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                    <button
                      onClick={() => setNewScope('global')}
                      className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${newScope === 'global' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
                    >
                      <Globe className="h-3 w-3" />
                      グローバル
                    </button>
                    <button
                      onClick={() => setNewScope('project')}
                      className={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium transition-colors ${newScope === 'project' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
                    >
                      <FolderOpen className="h-3 w-3" />
                      プロジェクト
                    </button>
                  </div>
                  {/* Category → Theme selector (project scope only) */}
                  {newScope === 'project' && (
                    <>
                      <select
                        value={newCategoryId ?? ''}
                        onChange={(e) => {
                          const id = e.target.value ? parseInt(e.target.value) : null;
                          setNewCategoryId(id);
                          setNewThemeId(null);
                        }}
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <option value="">カテゴリ</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={newThemeId ?? ''}
                        onChange={(e) =>
                          setNewThemeId(e.target.value ? parseInt(e.target.value) : null)
                        }
                        className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <option value="">テーマ</option>
                        {filteredThemes.map((th) => (
                          <option key={th.id} value={th.id}>
                            {th.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!newTitle.trim() || isSubmitting}
                    className="flex items-center gap-1 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : editingId !== null ? (
                      <Pencil className="h-3 w-3" />
                    ) : (
                      <Lightbulb className="h-3 w-3" />
                    )}
                    {editingId !== null ? '更新' : '保存'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 編集中・追加フォーム表示中は一覧・フィルタ・ページネーションを隠して、入力 UI に集中させる */}
        {editingId === null && !showQuickAdd && (
          <>
            {/* Filters — three dropdowns: scope / category / theme */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as IdeaScope | 'all')}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="all">すべて</option>
                <option value="global">グローバル</option>
                <option value="project">プロジェクト</option>
              </select>
              <select
                value={filterCategoryId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value) : null;
                  setFilterCategoryId(id);
                  setFilterThemeId(null);
                }}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="">すべてのカテゴリ</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <select
                value={filterThemeId ?? ''}
                onChange={(e) => setFilterThemeId(e.target.value ? parseInt(e.target.value) : null)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="">すべてのテーマ</option>
                {filterThemes.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </select>
              {searchQuery && (
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  検索: 「{searchQuery}」
                </span>
              )}
            </div>

            {/* Idea list */}
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Lightbulb className="h-12 w-12 text-zinc-200 dark:text-zinc-700 mb-3" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {searchQuery ? '検索結果がありません' : 'アイデアがまだありません'}
                </p>
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                  上の「アイデアを追加」ボタンで気軽にメモしましょう
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {paginatedFiltered.map((idea) => {
                  const SourceIcon = SOURCE_ICONS[idea.source] ?? User;
                  return (
                    <div
                      key={idea.id}
                      className={`group rounded-xl border px-4 py-3 transition-colors ${
                        idea.usedInTaskId
                          ? 'border-zinc-100 bg-zinc-50/50 opacity-50 dark:border-zinc-800 dark:bg-zinc-900/30'
                          : 'border-zinc-200 bg-white hover:border-amber-300 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-amber-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Lightbulb className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                              {idea.title}
                            </span>
                            {idea.scope === 'global' ? (
                              <Globe className="h-3 w-3 text-indigo-400" />
                            ) : (
                              (() => {
                                const currentTheme = themes.find((t) => t.id === idea.themeId);
                                const ThemeIcon =
                                  getIconComponent(currentTheme?.icon || '') || FolderOpen;
                                const themeColor = currentTheme?.color || '#059669'; // fallback to emerald-600
                                return (
                                  <span
                                    className="flex items-center gap-0.5 text-[9px]"
                                    style={{ color: themeColor }}
                                  >
                                    <ThemeIcon className="h-3 w-3" />
                                    {currentTheme?.name ?? 'プロジェクト'}
                                  </span>
                                );
                              })()
                            )}
                          </div>
                          {idea.content !== idea.title && (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                              {idea.content}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-400">
                            <span className="flex items-center gap-0.5">
                              <SourceIcon className="h-2.5 w-2.5" />
                              {idea.source === 'user'
                                ? '手動'
                                : idea.source === 'agent_execution'
                                  ? 'エージェント'
                                  : idea.source === 'copilot'
                                    ? 'コパイロット'
                                    : idea.source}
                            </span>
                            <span>{new Date(idea.createdAt).toLocaleDateString('ja-JP')}</span>
                            {idea.usedInTaskId && (
                              <span className="text-emerald-500">タスク化済み</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                          {!idea.usedInTaskId && (
                            <>
                              <button
                                onClick={() => openManualConvert(idea)}
                                className="rounded p-1 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                aria-label="手動でタスク化"
                                title="手動でタスク化 (フィールドを編集してから起票)"
                              >
                                <ListPlus className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => handleConvertToTask(idea)}
                                disabled={isConverting && convertingIdeaId === idea.id}
                                className="rounded p-1 text-zinc-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                                aria-label="AI でタスク化"
                                title="AI が内容を整形してタスク化"
                              >
                                {isConverting && convertingIdeaId === idea.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ArrowRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleEdit(idea)}
                            className="rounded p-1 text-zinc-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                            aria-label="編集"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(idea.id)}
                            className="rounded p-1 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            aria-label="削除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination - 検索時も表示 */}
            {!isLoading && filtered.length > 0 && (
              <Pagination
                currentPage={currentPage}
                totalPages={dynamicTotalPages}
                itemsPerPage={itemsPerPage}
                onPageChange={handlePageChange}
                onItemsPerPageChange={handleItemsPerPageChange}
                itemsPerPageOptions={[5, 10, 15]}
              />
            )}
          </>
        )}
      </div>

      {/* 手動タスク化モーダル */}
      {manualConvertIdea && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeManualConvert}
        >
          <div
            className="w-full max-w-lg mx-3 bg-white dark:bg-zinc-900 rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                アイデアをタスクとして起票
              </h2>
              <button
                onClick={closeManualConvert}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  タイトル <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="タスクのタイトル"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  説明
                </label>
                <textarea
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  rows={5}
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="タスクの詳細"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    優先度
                  </label>
                  <select
                    value={manualPriority}
                    onChange={(e) => setManualPriority(e.target.value as typeof manualPriority)}
                    className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="urgent">緊急</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                    予想時間 (h)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={manualEstimatedHours}
                    onChange={(e) => setManualEstimatedHours(e.target.value)}
                    className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="任意"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  テーマ <span className="text-red-500">*</span>
                </label>
                <select
                  value={manualThemeId ?? ''}
                  onChange={(e) =>
                    setManualThemeId(e.target.value ? parseInt(e.target.value) : null)
                  }
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">テーマを選択してください</option>
                  {themes.map((th) => (
                    <option key={th.id} value={th.id}>
                      {th.name}
                    </option>
                  ))}
                </select>
              </div>
              {manualError && (
                <p className="text-xs text-red-600 dark:text-red-400">{manualError}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-lg">
              <button
                onClick={closeManualConvert}
                disabled={isManualSubmitting}
                className="rounded px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={submitManualConvert}
                disabled={isManualSubmitting || !manualTitle.trim() || manualThemeId === null}
                className="flex items-center gap-1.5 rounded bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {isManualSubmitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ListPlus className="h-3.5 w-3.5" />
                )}
                タスク化
              </button>
            </div>
          </div>
        </div>
      )}

      {/* テーマ選択モーダル — グローバルアイデアの AI タスク化前に表示 */}
      {themePickerIdea && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={closeThemePicker}
        >
          <div
            className="w-full max-w-md mx-3 bg-white dark:bg-zinc-900 rounded-lg shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                テーマを選択
              </h2>
              <button
                onClick={closeThemePicker}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="閉じる"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                このアイデアにはテーマが設定されていません。タスクとして登録するにはテーマを選択してください。
              </p>
              <div className="rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
                  {themePickerIdea.title}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  カテゴリ
                </label>
                <select
                  value={themePickerCategoryId ?? ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseInt(e.target.value) : null;
                    setThemePickerCategoryId(value);
                    setThemePickerThemeId(null);
                  }}
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">すべて</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  テーマ <span className="text-red-500">*</span>
                </label>
                <select
                  value={themePickerThemeId ?? ''}
                  onChange={(e) =>
                    setThemePickerThemeId(e.target.value ? parseInt(e.target.value) : null)
                  }
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="">テーマを選択してください</option>
                  {themePickerThemes.map((th) => (
                    <option key={th.id} value={th.id}>
                      {th.name}
                    </option>
                  ))}
                </select>
                {themePickerThemes.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    選択したカテゴリにテーマがありません。先にテーマを作成してください。
                  </p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-lg">
              <button
                onClick={closeThemePicker}
                className="rounded px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                キャンセル
              </button>
              <button
                onClick={submitThemePicker}
                disabled={themePickerThemeId === null}
                className="flex items-center gap-1.5 rounded bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <ArrowRight className="h-3.5 w-3.5" />
                タスク化
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
