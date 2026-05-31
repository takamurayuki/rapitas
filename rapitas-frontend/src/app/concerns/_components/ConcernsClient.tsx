'use client';

/**
 * ConcernsClient
 *
 * The 懸念バックログ (Concern Backlog) page — a bug/refactor/risk sibling of the
 * idea box. Lists concerns filed by agents (during task execution) and users,
 * and lets you turn each into a dedicated task or dismiss it.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Bug,
  Wrench,
  ShieldAlert,
  Gauge,
  CircleDot,
  FolderOpen,
  Plus,
  ListPlus,
  Trash2,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import Pagination from '@/components/ui/pagination/Pagination';
import { Modal } from '@/components/ui/modal/Modal';
import PriorityIcon from '@/feature/tasks/components/PriorityIcon';

type ConcernType = 'bug' | 'refactor' | 'security' | 'perf' | 'other';
type ConcernSeverity = 'urgent' | 'high' | 'medium' | 'low';
type ConcernStatus = 'open' | 'task_created' | 'dismissed';

interface Concern {
  id: number;
  title: string;
  detail: string;
  type: ConcernType;
  severity: ConcernSeverity;
  location: string | null;
  status: ConcernStatus;
  originTaskId: number | null;
  createdTaskId: number | null;
  themeId: number | null;
  createdAt: string;
}

const TYPE_META: Record<ConcernType, { label: string; icon: typeof Bug; badge: string }> = {
  bug: { label: 'バグ', icon: Bug, badge: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300' },
  refactor: {
    label: 'リファクタ',
    icon: Wrench,
    badge: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300',
  },
  security: {
    label: 'セキュリティ',
    icon: ShieldAlert,
    badge: 'bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-300',
  },
  perf: {
    label: 'パフォーマンス',
    icon: Gauge,
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
  },
  other: {
    label: 'その他',
    icon: CircleDot,
    badge: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  },
};
const TYPE_ORDER: ConcernType[] = ['bug', 'refactor', 'security', 'perf', 'other'];

const SEVERITY_META: Record<ConcernSeverity, { label: string; badge: string; active: string }> = {
  urgent: {
    label: '緊急',
    badge: 'bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-700',
    active: 'bg-red-200 text-red-800 dark:bg-red-900/60 dark:text-red-200',
  },
  high: {
    label: '高',
    badge: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:ring-rose-800',
    active: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
  medium: {
    label: '中',
    badge: 'bg-amber-50 text-amber-600 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
    active: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  low: {
    label: '低',
    badge: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800',
    active: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  },
};
const SEVERITY_ORDER: ConcernSeverity[] = ['urgent', 'high', 'medium', 'low'];
/** Severity = how serious / urgent the concern is. Shown via PriorityIcon. */
const SEVERITY_HINT: Record<ConcernSeverity, string> = {
  urgent: '緊急 — 早急に対処すべき',
  high: '高 — 影響が大きい',
  medium: '中 — 着実に対処したい',
  low: '低 — あれば直したい',
};

const STATUS_TABS: { value: ConcernStatus | 'all'; label: string }[] = [
  { value: 'open', label: '未対応' },
  { value: 'task_created', label: 'タスク化済' },
  { value: 'dismissed', label: '却下' },
  { value: 'all', label: 'すべて' },
];

export default function ConcernsClient() {
  const [concerns, setConcerns] = useState<Concern[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ConcernStatus | 'all'>('open');
  const [typeFilter, setTypeFilter] = useState<ConcernType | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<ConcernSeverity | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

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
  const filteredThemes = newCategoryId
    ? themes.filter((t) => t.categoryId === newCategoryId)
    : themes;

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
  }, [statusFilter, typeFilter, severityFilter, currentPage, itemsPerPage]);

  useEffect(() => {
    fetchConcerns();
  }, [fetchConcerns]);

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, typeFilter, severityFilter]);

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

  const handleDelete = useCallback(
    async (id: number) => {
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
    },
    [],
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
            {/* Severity — moved below the title (icons like the task list) */}
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">重大度</span>
              <span
                className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
                title="重大度（将来の影響の大きさ）"
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
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
            >
              {TYPE_ORDER.map((ty) => (
                <option key={ty} value={ty}>
                  {TYPE_META[ty].label}
                </option>
              ))}
            </select>
            {/* Project (category → theme) — concerns are always project-scoped */}
            <span className="flex items-center gap-1 text-zinc-400" title="対象プロジェクト">
              <FolderOpen className="h-3 w-3" />
            </span>
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
              onChange={(e) => setNewThemeId(e.target.value ? parseInt(e.target.value) : null)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">テーマ</option>
              {filteredThemes.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </select>
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
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
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
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="all">すべての重大度</option>
          {SEVERITY_ORDER.map((sv) => (
            <option key={sv} value={sv}>
              {SEVERITY_META[sv].label}
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
          {concerns.map((c) => {
            const TyIcon = TYPE_META[c.type].icon;
            const busy = busyId === c.id;
            return (
              <div
                key={c.id}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TYPE_META[c.type].badge}`}
                      >
                        <TyIcon className="h-2.5 w-2.5" />
                        {TYPE_META[c.type].label}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_META[c.severity].badge}`}
                      >
                        重大度 {SEVERITY_META[c.severity].label}
                      </span>
                      {c.status === 'task_created' && c.createdTaskId && (
                        <a
                          href={`/tasks/${c.createdTaskId}`}
                          className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:underline dark:bg-emerald-900/30 dark:text-emerald-300"
                        >
                          タスク化済 #{c.createdTaskId}
                        </a>
                      )}
                      {c.status === 'dismissed' && (
                        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                          却下
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-400">
                        {new Date(c.createdAt).toLocaleDateString('ja-JP')}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {c.title}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-zinc-500 dark:text-zinc-400">
                      {c.detail}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                      {c.location && (
                        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono dark:bg-zinc-800">
                          {c.location}
                        </code>
                      )}
                      {c.originTaskId && (
                        <a href={`/tasks/${c.originTaskId}`} className="hover:underline">
                          発見元 #{c.originTaskId}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-700/50">
                  {c.status === 'open' && (
                    <button
                      onClick={() => handleConvert(c.id)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-lg bg-indigo-500 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ListPlus className="h-3 w-3" />
                      )}
                      タスク化
                    </button>
                  )}
                  {c.status === 'open' && (
                    <button
                      onClick={() => handleDismiss(c.id, true)}
                      disabled={busy}
                      className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                    >
                      却下
                    </button>
                  )}
                  {c.status === 'dismissed' && (
                    <button
                      onClick={() => handleDismiss(c.id, false)}
                      disabled={busy}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                    >
                      <ArrowRight className="h-3 w-3" />
                      未対応に戻す
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    disabled={busy}
                    title="削除"
                    className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
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
