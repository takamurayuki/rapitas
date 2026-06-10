'use client';

/**
 * ConcernsClient
 *
 * The 懸念バックログ (Concern Backlog) page — a bug/refactor/risk sibling of the
 * idea box. Lists concerns filed by agents (during task execution) and users,
 * and lets you turn each into a dedicated task or dismiss it.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Bug, Plus, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import Pagination from '@/components/ui/pagination/Pagination';
import { Modal } from '@/components/ui/modal/Modal';
import { useToast } from '@/components/ui/toast/ToastContainer';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';
import { ConcernCard } from './ConcernCard';
import {
  TYPE_META,
  TYPE_ORDER,
  SEVERITY_META,
  SEVERITY_ORDER,
  SEVERITY_HINT,
  STATUS_TABS,
  type Concern,
  type ConcernType,
  type ConcernSeverity,
  type ConcernStatus,
  type GhIntegration,
} from './concern-shared';

export default function ConcernsClient() {
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ConcernStatus | 'all'>('open');
  const [typeFilter, setTypeFilter] = useState<ConcernType | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<ConcernSeverity | 'all'>('all');
  const [themeFilter, setThemeFilter] = useState<number | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  // GitHub integrations available as publish targets (empty = no repos linked).
  const [integrations, setIntegrations] = useState<GhIntegration[]>([]);

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
  // Concerns publish to a theme's repo, so only themes with a working directory
  // are selectable. (Shared rule with the idea box.)
  const workingDirThemes = themes.filter((t) => t.workingDirectory);
  const filteredThemes = newCategoryId
    ? workingDirThemes.filter((t) => t.categoryId === newCategoryId)
    : workingDirThemes;
  // Theme lookup for the per-card theme-name badge.
  const themeById = new Map(themes.map((t) => [t.id, t]));
  const { showToast } = useToast();

  const totalPages = Math.ceil(total / itemsPerPage);

  const fetchConcerns = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      if (typeFilter !== 'all') params.set('type', typeFilter);
      if (severityFilter !== 'all') params.set('severity', severityFilter);
      if (themeFilter !== 'all') params.set('themeId', String(themeFilter));
      const res = await fetch(`${API_BASE_URL}/concerns?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { concerns: Concern[]; total: number };
        setConcerns(data.concerns);
        setTotal(data.total);
      }
    } catch {
      /* non-fatal */
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, typeFilter, severityFilter, themeFilter, currentPage, itemsPerPage]);

  useEffect(() => {
    fetchConcerns();
  }, [fetchConcerns]);

  // Load publish targets once; failure just hides the publish button.
  useEffect(() => {
    fetch(`${API_BASE_URL}/github/integrations`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data: GhIntegration[]) => setIntegrations(Array.isArray(data) ? data : []))
      .catch(() => setIntegrations([]));
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, typeFilter, severityFilter, themeFilter]);

  const resetForm = () => {
    setNewTitle('');
    setNewDetail('');
    setNewType('bug');
    setNewSeverity('medium');
    setNewLocation('');
    setNewCategoryId(null);
    setNewThemeId(null);
  };

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
      if (!res.ok) return;
      resetForm();
      // Keep the modal open (cleared) so the user can file another right away.
      setTimeout(() => titleRef.current?.focus(), 0);
      await fetchConcerns();
    } catch {
      /* error */
    }
  }, [newTitle, newDetail, newType, newSeverity, newLocation, newThemeId, fetchConcerns]);

  const handleConvert = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        const res = await fetch(`${API_BASE_URL}/concerns/${id}/convert-to-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) await fetchConcerns();
      } catch {
        /* error */
      } finally {
        setBusyId(null);
      }
    },
    [fetchConcerns],
  );

  const handleDismiss = useCallback(
    async (id: number, dismiss: boolean) => {
      setBusyId(id);
      try {
        const res = await fetch(`${API_BASE_URL}/concerns/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: dismiss ? 'dismissed' : 'open' }),
        });
        if (res.ok) await fetchConcerns();
      } catch {
        /* error */
      } finally {
        setBusyId(null);
      }
    },
    [fetchConcerns],
  );

  const handleDelete = useCallback(async (id: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/concerns/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConcerns((prev) => prev.filter((c) => c.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      }
    } catch {
      /* error */
    } finally {
      setBusyId(null);
    }
  }, []);

  const handlePublish = useCallback(
    async (id: number): Promise<void> => {
      setBusyId(id);
      try {
        // One click: no integrationId — the server resolves the repo from the
        // concern's theme and creates the issue directly.
        const res = await fetch(`${API_BASE_URL}/github/concerns/${id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          showToast('GitHub Issue を作成しました', 'success');
          await fetchConcerns();
          return;
        }
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        showToast(data?.error || 'GitHub への公開に失敗しました', 'error');
      } catch {
        showToast('GitHub への公開に失敗しました', 'error');
      } finally {
        setBusyId(null);
      }
    },
    [fetchConcerns, showToast],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-rose-500" />
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">懸念バックログ</h1>
          <span className="text-xs text-zinc-400">スコープ外の懸念を起票・タスク化</span>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600"
        >
          <Plus className="h-3.5 w-3.5" />
          懸念を追加
        </button>
      </div>

      {/* Add form — modal so filing keeps you on the page (continuous adding) */}
      <Modal
        open={showAdd}
        onClose={() => {
          resetForm();
          setShowAdd(false);
        }}
        icon={<Bug className="h-4 w-4 text-rose-500" />}
        title="懸念を追加"
        maxWidthClass="max-w-2xl"
        footer={
          <>
            <button
              onClick={() => {
                resetForm();
                setShowAdd(false);
              }}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              キャンセル
            </button>
            <button
              onClick={handleSubmit}
              disabled={!newTitle.trim() || !newDetail.trim()}
              className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-40"
            >
              登録
            </button>
          </>
        }
      >
        <div>
          <input
            ref={titleRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="懸念をひとことで（例: 認証トークンが失効しても再ログインされない）"
            className="mb-2 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
          />
          <textarea
            value={newDetail}
            onChange={(e) => setNewDetail(e.target.value)}
            placeholder="何が問題で、なぜ重要か"
            rows={3}
            className="mb-2 w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* Priority — moved below the title (icons like the task list) */}
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">優先度</span>
              <span
                className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
                title="優先度（将来の影響の大きさ）"
              >
                {SEVERITY_ORDER.map((sv) => (
                  <button
                    key={sv}
                    type="button"
                    onClick={() => setNewSeverity(sv)}
                    title={SEVERITY_HINT[sv]}
                    className={`px-2 py-1 transition-colors ${
                      newSeverity === sv
                        ? 'bg-zinc-100 dark:bg-zinc-800'
                        : 'opacity-40 hover:opacity-100 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <PriorityIcon priority={sv} size="sm" showTitle />
                  </button>
                ))}
              </span>
            </span>
            {/* Type — pulldown to keep the row compact */}
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as ConcernType)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
            >
              {TYPE_ORDER.map((ty) => (
                <option key={ty} value={ty}>
                  {TYPE_META[ty].label}
                </option>
              ))}
            </select>
            {/* Project (category → theme) on one line — always project-scoped */}
            <span className="flex items-center gap-2">
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
            </span>
            <input
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="対象箇所 (任意, 例: src/auth/token.ts:42)"
              className="min-w-[10rem] flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-[11px] outline-none focus:border-blue-400 dark:border-zinc-700"
            />
          </div>
        </div>
      </Modal>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                  : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as ConcernType | 'all')}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="all">すべての種別</option>
          {TYPE_ORDER.map((ty) => (
            <option key={ty} value={ty}>
              {TYPE_META[ty].label}
            </option>
          ))}
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value as ConcernSeverity | 'all')}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="all">すべての優先度</option>
          {SEVERITY_ORDER.map((sv) => (
            <option key={sv} value={sv}>
              {SEVERITY_META[sv].label}
            </option>
          ))}
        </select>
        <select
          value={themeFilter === 'all' ? '' : String(themeFilter)}
          onChange={(e) => setThemeFilter(e.target.value ? parseInt(e.target.value) : 'all')}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="">すべてのテーマ</option>
          {workingDirThemes.map((th) => (
            <option key={th.id} value={th.id}>
              {th.name}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : concerns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-400 dark:border-zinc-700">
          該当する懸念はありません。
        </div>
      ) : (
        <div className="space-y-2">
          {concerns.map((c) => (
            <ConcernCard
              key={c.id}
              concern={c}
              busy={busyId === c.id}
              canPublish={integrations.length > 0}
              theme={c.themeId != null ? (themeById.get(c.themeId) ?? null) : null}
              onConvert={handleConvert}
              onDismiss={handleDismiss}
              onDelete={handleDelete}
              onPublish={handlePublish}
            />
          ))}
        </div>
      )}

      {!isLoading && totalPages >= 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={(n) => {
            setItemsPerPage(n);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );
}
