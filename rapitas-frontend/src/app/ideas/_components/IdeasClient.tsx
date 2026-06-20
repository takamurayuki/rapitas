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
import { Modal } from '@/components/ui/modal/Modal';
import { useToast } from '@/components/ui/toast/ToastContainer';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';

type IdeaScope = 'global' | 'project';
type IdeaPriority = 'urgent' | 'high' | 'medium' | 'low';

interface Idea {
  id: number;
  title: string;
  content: string;
  category: string;
  scope: IdeaScope;
  priority: IdeaPriority;
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

/**
 * Idea priority = how much it would innovate / raise the app's value if built.
 * Rendered with the same PriorityIcon as the task list for consistency.
 */
const PRIORITY_ORDER: IdeaPriority[] = ['urgent', 'high', 'medium', 'low'];
const PRIORITY_HINT: Record<IdeaPriority, string> = {
  urgent: '最優先で取り組むべき',
  high: '革新的・アプリ価値を大きく底上げ',
  medium: '着実に価値を高める',
  low: '小さな改善・あれば良い',
};

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
  // Default 10 per page to match the task list pagination.
  const [itemsPerPage, setItemsPerPage] = useLocalStorageState('ideaBox.itemsPerPage', 10);
  const [totalPages, setTotalPages] = useState(0);
  const [totalIdeas, setTotalIdeas] = useState(0);

  const [filterCategoryId, setFilterCategoryId] = useState<number | null>(null);
  const [filterThemeId, setFilterThemeId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | 'used' | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | IdeaPriority>('all');
  const searchParams = useSearchParams();
  const searchQuery = searchParams?.get('search')?.trim() ?? '';
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newPriority, setNewPriority] = useState<IdeaPriority>('medium');
  const [newCategoryId, setNewCategoryId] = useState<number | null>(null);
  const [newThemeId, setNewThemeId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const { categories, themes } = useFilterDataStore();
  const { showToast } = useToast();
  // Ideas are turned into tasks that run in a theme's repo, so theme pulldowns
  // only offer themes that have a working directory set. (Shared rule with the
  // concern backlog.) Theme-name display still uses the full `themes` list.
  const wdThemes = themes.filter((t) => t.workingDirectory);

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

  // テーマ未設定アイデアのタスク化前テーマ選択モーダル状態
  // NOTE: グローバルアイデア（テーマ未設定）はそのままタスク化するとワークフローで起票できないため、必ずテーマを選ばせる。
  const [themePickerIdea, setThemePickerIdea] = useState<Idea | null>(null);
  const [themePickerCategoryId, setThemePickerCategoryId] = useState<number | null>(null);
  const [themePickerThemeId, setThemePickerThemeId] = useState<number | null>(null);
  const themePickerThemes = themePickerCategoryId
    ? wdThemes.filter((t) => t.categoryId === themePickerCategoryId)
    : wdThemes;

  const filteredThemes = newCategoryId
    ? wdThemes.filter((t) => t.categoryId === newCategoryId)
    : wdThemes;

  const filterThemes = filterCategoryId
    ? wdThemes.filter((t) => t.categoryId === filterCategoryId)
    : wdThemes;

  const fetchIdeas = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      if (filterCategoryId) params.set('categoryId', String(filterCategoryId));
      // NOTE: themeIdフィルタリングもサーバーサイドで処理するため追加
      if (filterThemeId) params.set('themeId', String(filterThemeId));
      if (statusFilter !== 'all') params.set('status', statusFilter);
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
  }, [filterCategoryId, filterThemeId, statusFilter, priorityFilter, currentPage, itemsPerPage]);

  useEffect(() => {
    fetchIdeas();
  }, [fetchIdeas]);

  // フィルタ変更時のページリセット
  useEffect(() => {
    setCurrentPage(1);
  }, [filterCategoryId, filterThemeId, statusFilter, priorityFilter, searchQuery]);

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
    setNewPriority('medium');
    setNewCategoryId(null);
    setNewThemeId(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!newTitle.trim()) return;

    const payload = {
      title: newTitle.trim(),
      content: newContent.trim() || newTitle.trim(),
      scope: 'project' as IdeaScope,
      priority: newPriority,
      // Ideas are always project-scoped now; null themeId = unassigned project.
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
        showToast('アイデアの更新に失敗しました', 'error');
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
      scope: 'project',
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
    } catch {
      // Roll back the optimistic entry if the submission failed.
      setIdeas((prev) => prev.filter((i) => i.id !== tempId));
      showToast('アイデアの登録に失敗しました', 'error');
    }
  }, [editingId, newTitle, newContent, newPriority, newThemeId, fetchIdeas, resetForm, showToast]);

  const handleEdit = useCallback(
    (idea: Idea) => {
      setEditingId(idea.id);
      setNewTitle(idea.title);
      setNewContent(idea.content === idea.title ? '' : idea.content);
      setNewPriority(idea.priority);
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

  const handleDelete = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/idea-box/${id}`, { method: 'DELETE' });
        if (!res.ok) {
          showToast('アイデアの削除に失敗しました', 'error');
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
        showToast('アイデアの削除に失敗しました', 'error');
      }
    },
    [ideas.length, currentPage, fetchIdeas, showToast],
  );

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

  const submitThemePicker = useCallback(async () => {
    if (!themePickerIdea || themePickerThemeId === null) return;
    const idea = themePickerIdea;
    const themeId = themePickerThemeId;
    closeThemePicker();
    await executeQuickConvert(idea, themeId);
  }, [themePickerIdea, themePickerThemeId, executeQuickConvert, closeThemePicker]);

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
      showToast('タスクへの変換に失敗しました', 'error');
    } finally {
      setIsSubmitting(false);
    }
  }, [editingId, newTitle, newContent, newPriority, newThemeId, fetchIdeas, resetForm, showToast]);

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

        {/* Quick Add — modal so adding keeps you on the page (continuous adding) */}
        <Modal
          open={showQuickAdd}
          onClose={handleCancel}
          icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
          maxWidthClass="max-w-2xl"
          title={editingId !== null ? 'アイデアを編集' : 'アイデアを追加'}
          footer={
            <>
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
              {/* When editing, save the changes AND file the task in one click.
                  Needs a theme (workflow registration). */}
              {editingId !== null && (
                <button
                  onClick={handleSaveAndConvert}
                  disabled={!newTitle.trim() || isSubmitting || newThemeId === null}
                  title={
                    newThemeId === null ? 'タスク化にはテーマが必要です' : '変更を保存してタスク化'
                  }
                  className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <ListPlus className="h-3 w-3" />
                  )}
                  保存してタスク化
                </button>
              )}
            </>
          }
        >
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
              placeholder="アイデアをひとことで..."
              className="w-full rounded-lg border-0 bg-white px-4 py-3 text-sm shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:bg-zinc-800 dark:placeholder:text-zinc-500"
            />
            <textarea
              ref={contentTextareaRef}
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="詳細（任意）"
              className="w-full rounded-lg border-0 bg-white px-4 py-2.5 text-xs shadow-sm placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:bg-zinc-800 dark:placeholder:text-zinc-500 resize-none overflow-hidden min-h-[3rem] max-h-[60vh]"
              style={{ overflowY: 'auto' }}
            />
            <div className="flex flex-wrap items-center gap-2">
              {/* Priority — moved below the title */}
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">優先度</span>
                <span
                  className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
                  title="優先度（アプリへの革新性・価値の底上げ度合い）"
                >
                  {PRIORITY_ORDER.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewPriority(p)}
                      title={PRIORITY_HINT[p]}
                      className={`px-2 py-1 transition-colors ${
                        newPriority === p
                          ? 'bg-zinc-100 dark:bg-zinc-800'
                          : 'opacity-40 hover:opacity-100 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                      }`}
                    >
                      <PriorityIcon priority={p} size="sm" showTitle />
                    </button>
                  ))}
                </span>
              </span>
              {/* Category → Theme — ideas are always project-scoped */}
              <select
                value={newCategoryId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value) : null;
                  setNewCategoryId(id);
                  setNewThemeId(null);
                }}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
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
                onChange={(e) => setNewThemeId(e.target.value ? parseInt(e.target.value) : null)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="">テーマ</option>
                {filteredThemes.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Modal>

        {/* List + filters + pagination (always visible; the add/edit modal overlays). */}
        {
          <>
            {/* Filters — status / priority / category / theme */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {/* Status */}
              <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                {(
                  [
                    { value: 'open', label: '未対応' },
                    { value: 'used', label: 'タスク化済み' },
                    { value: 'all', label: 'すべて' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setStatusFilter(tab.value)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      statusFilter === tab.value
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              {/* Priority */}
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as 'all' | IdeaPriority)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
              >
                <option value="all">すべての優先度</option>
                <option value="urgent">緊急</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
              <select
                value={filterCategoryId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? parseInt(e.target.value) : null;
                  setFilterCategoryId(id);
                  setFilterThemeId(null);
                }}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
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
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
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
                  // Converted ideas stay fully visible (not dimmed) and show a
                  // clickable "タスク化済 #ID" badge — matching how the concern
                  // backlog renders task_created items (see ConcernCard).
                  return (
                    <div
                      key={idea.id}
                      className={`group rounded-xl border px-4 py-3 transition-colors ${
                        idea.usedInTaskId
                          ? 'border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800/50'
                          : 'border-zinc-200 bg-white hover:border-amber-300 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-amber-700'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Lightbulb className="mt-0.5 h-4 w-4 text-amber-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            {/* Title, then theme + priority icon right beside it */}
                            <span className="min-w-0 truncate font-medium text-sm text-zinc-900 dark:text-zinc-100">
                              {idea.title}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
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
                              <span title={`優先度: ${PRIORITY_HINT[idea.priority]}`}>
                                <PriorityIcon priority={idea.priority} size="sm" />
                              </span>
                            </span>
                            {/* タスク化済バッジ — テーマ名の右横（懸念バックログと同じ配置）。
                                /tasks/{ID} へ遷移する。 */}
                            {idea.usedInTaskId && (
                              <a
                                href={`/tasks/${idea.usedInTaskId}`}
                                className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:underline dark:bg-emerald-900/30 dark:text-emerald-300"
                              >
                                タスク化済 #{idea.usedInTaskId}
                              </a>
                            )}
                            {/* Source (manual / agent / AI assistant) — far right */}
                            <span className="ml-auto flex shrink-0 items-center gap-0.5 text-[10px] text-zinc-400">
                              <SourceIcon className="h-2.5 w-2.5" />
                              {idea.source === 'user'
                                ? '手動'
                                : idea.source === 'agent_execution'
                                  ? 'エージェント'
                                  : idea.source === 'copilot'
                                    ? 'AIアシスタント'
                                    : idea.source}
                            </span>
                          </div>
                          {idea.content !== idea.title && (
                            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                              {idea.content}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-400">
                            <span>{new Date(idea.createdAt).toLocaleDateString('ja-JP')}</span>
                          </div>
                        </div>
                      </div>
                      {/* Actions — grouped at the bottom (always visible), like
                          the concern card. タスク化 files immediately (no AI). */}
                      <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-700/50">
                        {!idea.usedInTaskId && (
                          <>
                            <button
                              onClick={() => handleConvertToTask(idea)}
                              disabled={isConverting && convertingIdeaId === idea.id}
                              title="タスク化（すぐ起票・AIなし）"
                              className="flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
                            >
                              {isConverting && convertingIdeaId === idea.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <ListPlus className="h-3 w-3" />
                              )}
                              タスク化
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleEdit(idea)}
                          className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-amber-600 dark:hover:bg-zinc-800 dark:hover:text-amber-400 transition-colors"
                          aria-label="アイデアを編集"
                          title="アイデアを編集"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(idea.id)}
                          className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800 transition-colors"
                          aria-label="削除"
                          title="削除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
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
                alwaysShow
              />
            )}
          </>
        }
      </div>

      {/* テーマ選択モーダル — テーマ未設定アイデアのタスク化前に表示（ワークフロー登録にテーマ必須） */}
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
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-blue-400"
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
                  className="w-full rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-blue-400"
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
