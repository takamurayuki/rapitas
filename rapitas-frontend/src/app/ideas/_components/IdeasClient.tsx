'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
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
  const [itemsPerPage, setItemsPerPage] = useState(15);
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
  const { categories, themes } = useFilterDataStore();

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
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="詳細（任意）"
                rows={2}
                className="w-full rounded-lg border-0 bg-white px-4 py-2.5 text-xs shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-zinc-800 dark:placeholder:text-zinc-500 resize-none"
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
      </div>
    </div>
  );
}
