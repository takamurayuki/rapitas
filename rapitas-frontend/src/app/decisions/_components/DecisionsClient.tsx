'use client';

/**
 * DecisionsClient
 *
 * The デシジョンジャーナル (Decision Journal) page. Records deliberate decisions
 * with predicted outcomes and confidence scores, then lets the user review
 * them against actual results to track calibration accuracy over time.
 */

import { useState, useCallback, useEffect } from 'react';
import { Trash2, ListPlus, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { useFilterDataStore } from '@/stores/filter-data-store';
import Pagination from '@/components/ui/pagination/Pagination';
import { Modal } from '@/components/ui/modal/Modal';
import { Scale } from 'lucide-react';
import { DecisionJournalHeader } from './DecisionJournalHeader';

type CalibrationVerdict = 'pending' | 'correct' | 'partial' | 'wrong';
type DecisionStatus = 'open' | 'reviewed' | 'archived';

interface DecisionEntry {
  id: number;
  decision: string;
  context: string;
  rationale: string | null;
  predictedOutcome: string;
  confidence: number;
  reviewDate: string | null;
  actualOutcome: string | null;
  calibration: CalibrationVerdict;
  status: DecisionStatus;
  themeId: number | null;
  taskId: number | null;
  reviewedAt: string | null;
  createdAt: string;
}

const CALIBRATION_META: Record<
  CalibrationVerdict,
  { label: string; badge: string; icon: typeof CheckCircle2 }
> = {
  pending: {
    label: '未確認',
    badge: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
    icon: AlertCircle,
  },
  correct: {
    label: '正解',
    badge: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  partial: {
    label: '一部正解',
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-300',
    icon: AlertCircle,
  },
  wrong: {
    label: '不正解',
    badge: 'bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300',
    icon: XCircle,
  },
};

const STATUS_TABS: { value: DecisionStatus | 'all'; label: string }[] = [
  { value: 'open', label: '未レビュー' },
  { value: 'reviewed', label: 'レビュー済' },
  { value: 'archived', label: 'アーカイブ' },
  { value: 'all', label: 'すべて' },
];

const CALIBRATION_OPTIONS: CalibrationVerdict[] = ['correct', 'partial', 'wrong'];
const CALIBRATION_LABELS: Record<CalibrationVerdict, string> = {
  pending: '未確認',
  correct: '正解（予測通り）',
  partial: '一部正解',
  wrong: '不正解',
};

export default function DecisionsClient() {
  const [decisions, setDecisions] = useState<DecisionEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [reviewDue, setReviewDue] = useState<DecisionEntry[]>([]);
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | 'all'>('open');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  // Create/Edit modal
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<DecisionEntry | null>(null);
  const [formDecision, setFormDecision] = useState('');
  const [formContext, setFormContext] = useState('');
  const [formRationale, setFormRationale] = useState('');
  const [formPredicted, setFormPredicted] = useState('');
  const [formConfidence, setFormConfidence] = useState(50);
  const [formReviewDate, setFormReviewDate] = useState('');
  const [formThemeId, setFormThemeId] = useState<number | null>(null);
  const [formCategoryId, setFormCategoryId] = useState<number | null>(null);

  // Review modal
  const [showReview, setShowReview] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewActual, setReviewActual] = useState('');
  const [reviewCalibration, setReviewCalibration] = useState<CalibrationVerdict>('correct');

  const { categories, themes } = useFilterDataStore();
  const filteredThemes = formCategoryId
    ? themes.filter((t) => t.categoryId === formCategoryId)
    : themes;

  const totalPages = Math.ceil(total / itemsPerPage);

  const fetchDecisions = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      const res = await fetch(`${API_BASE_URL}/decision-journal?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as { decisions: DecisionEntry[]; total: number };
        setDecisions(data.decisions);
        setTotal(data.total);
      }
    } catch {
      /* non-fatal */
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, currentPage, itemsPerPage]);

  const fetchReviewDue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/decision-journal/review-due`);
      if (res.ok) {
        const data = (await res.json()) as { decisions: DecisionEntry[] };
        setReviewDue(data.decisions);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    fetchDecisions();
  }, [fetchDecisions]);
  useEffect(() => {
    fetchReviewDue();
  }, [fetchReviewDue]);
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter]);

  const resetForm = () => {
    setFormDecision('');
    setFormContext('');
    setFormRationale('');
    setFormPredicted('');
    setFormConfidence(50);
    setFormReviewDate('');
    setFormThemeId(null);
    setFormCategoryId(null);
    setEditTarget(null);
  };

  const openEdit = (d: DecisionEntry) => {
    setEditTarget(d);
    setFormDecision(d.decision);
    setFormContext(d.context);
    setFormRationale(d.rationale ?? '');
    setFormPredicted(d.predictedOutcome);
    setFormConfidence(Math.round(d.confidence * 100));
    setFormReviewDate(d.reviewDate ? d.reviewDate.slice(0, 10) : '');
    setFormThemeId(d.themeId);
    setFormCategoryId(null);
    setShowAdd(true);
  };

  const handleSubmit = useCallback(async () => {
    if (!formDecision.trim() || !formContext.trim() || !formPredicted.trim()) return;
    const body = {
      decision: formDecision.trim(),
      context: formContext.trim(),
      rationale: formRationale.trim() || undefined,
      predictedOutcome: formPredicted.trim(),
      confidence: formConfidence / 100,
      reviewDate: formReviewDate || undefined,
      themeId: formThemeId ?? undefined,
    };
    try {
      const url = editTarget
        ? `${API_BASE_URL}/decision-journal/${editTarget.id}`
        : `${API_BASE_URL}/decision-journal`;
      const res = await fetch(url, {
        method: editTarget ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      resetForm();
      setShowAdd(false);
      await fetchDecisions();
    } catch {
      /* error */
    }
  }, [
    formDecision,
    formContext,
    formRationale,
    formPredicted,
    formConfidence,
    formReviewDate,
    formThemeId,
    editTarget,
    fetchDecisions,
  ]);

  const handleDelete = useCallback(async (id: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/decision-journal/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDecisions((p) => p.filter((d) => d.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      }
    } catch {
      /* error */
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleConvert = useCallback(
    async (id: number) => {
      setBusyId(id);
      try {
        const res = await fetch(`${API_BASE_URL}/decision-journal/${id}/convert-to-task`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) await fetchDecisions();
      } catch {
        /* error */
      } finally {
        setBusyId(null);
      }
    },
    [fetchDecisions],
  );

  const currentReview = reviewDue[reviewIndex];

  const handleReviewSubmit = useCallback(async () => {
    if (!currentReview || !reviewActual.trim()) return;
    setBusyId(currentReview.id);
    try {
      const res = await fetch(`${API_BASE_URL}/decision-journal/${currentReview.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actualOutcome: reviewActual.trim(),
          calibration: reviewCalibration,
        }),
      });
      if (!res.ok) return;
      setReviewActual('');
      setReviewCalibration('correct');
      const next = reviewIndex + 1;
      if (next < reviewDue.length) {
        setReviewIndex(next);
      } else {
        setShowReview(false);
        setReviewIndex(0);
        await fetchReviewDue();
        await fetchDecisions();
      }
    } catch {
      /* error */
    } finally {
      setBusyId(null);
    }
  }, [
    currentReview,
    reviewActual,
    reviewCalibration,
    reviewIndex,
    reviewDue,
    fetchReviewDue,
    fetchDecisions,
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <DecisionJournalHeader
        totalDecisions={total}
        reviewDueCount={reviewDue.length}
        onAddClick={() => {
          resetForm();
          setShowAdd(true);
        }}
        onReviewClick={() => {
          setReviewIndex(0);
          setReviewActual('');
          setReviewCalibration('correct');
          setShowReview(true);
        }}
      />

      {/* Create / Edit modal */}
      <Modal
        open={showAdd}
        onClose={() => {
          resetForm();
          setShowAdd(false);
        }}
        icon={<Scale className="h-4 w-4 text-indigo-600" />}
        title={editTarget ? '決定を編集' : '決定を記録'}
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
              disabled={!formDecision.trim() || !formContext.trim() || !formPredicted.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {editTarget ? '更新' : '記録'}
            </button>
          </>
        }
      >
        <div className="space-y-2">
          <input
            value={formDecision}
            onChange={(e) => setFormDecision(e.target.value)}
            placeholder="決定内容（例：新しいプロジェクト管理ツールの導入）"
            className="w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
          />
          <textarea
            value={formContext}
            onChange={(e) => setFormContext(e.target.value)}
            placeholder="なぜこの決定が必要だったか（背景）"
            rows={2}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
          />
          <textarea
            value={formPredicted}
            onChange={(e) => setFormPredicted(e.target.value)}
            placeholder="予想される結果"
            rows={2}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
          />
          <textarea
            value={formRationale}
            onChange={(e) => setFormRationale(e.target.value)}
            placeholder="根拠・理由（任意）"
            rows={2}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              確信度{' '}
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {formConfidence}%
              </span>
              <input
                type="range"
                min={10}
                max={100}
                step={10}
                value={formConfidence}
                onChange={(e) => setFormConfidence(parseInt(e.target.value))}
                className="w-28 accent-indigo-600"
              />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              レビュー日{' '}
              <input
                type="date"
                value={formReviewDate}
                onChange={(e) => setFormReviewDate(e.target.value)}
                className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-800"
              />
            </label>
            <select
              value={formCategoryId ?? ''}
              onChange={(e) => {
                setFormCategoryId(e.target.value ? parseInt(e.target.value) : null);
                setFormThemeId(null);
              }}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">カテゴリ</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={formThemeId ?? ''}
              onChange={(e) => setFormThemeId(e.target.value ? parseInt(e.target.value) : null)}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs outline-none dark:border-zinc-700 dark:bg-zinc-800"
            >
              <option value="">テーマ</option>
              {filteredThemes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Review modal */}
      <Modal
        open={showReview && !!currentReview}
        onClose={() => setShowReview(false)}
        icon={<Scale className="h-4 w-4 text-amber-600" />}
        title={`今日のレビュー ${reviewIndex + 1} / ${reviewDue.length}`}
        maxWidthClass="max-w-lg"
        footer={
          <>
            <button
              onClick={() => setShowReview(false)}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              閉じる
            </button>
            <button
              onClick={handleReviewSubmit}
              disabled={!reviewActual.trim() || busyId === currentReview?.id}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-40"
            >
              {reviewIndex + 1 < reviewDue.length ? '記録して次へ' : '記録して完了'}
            </button>
          </>
        }
      >
        {currentReview && (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
              <p className="text-xs text-zinc-500">決定</p>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {currentReview.decision}
              </p>
              <p className="mt-1 text-xs text-zinc-500">予想結果</p>
              <p className="text-xs text-zinc-700 dark:text-zinc-300">
                {currentReview.predictedOutcome}
              </p>
              <p className="mt-1 text-[11px] text-zinc-400">
                確信度 {Math.round(currentReview.confidence * 100)}%
              </p>
            </div>
            <textarea
              value={reviewActual}
              onChange={(e) => setReviewActual(e.target.value)}
              placeholder="実際の結果"
              rows={3}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-blue-400 dark:border-zinc-700"
            />
            <div className="flex gap-2">
              {CALIBRATION_OPTIONS.map((c) => {
                const m = CALIBRATION_META[c];
                return (
                  <button
                    key={c}
                    onClick={() => setReviewCalibration(c)}
                    className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${reviewCalibration === c ? `${m.badge} border-current` : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'}`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-1 text-xs font-medium transition-colors ${statusFilter === tab.value ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : decisions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 py-12 text-center text-sm text-zinc-400 dark:border-zinc-700">
          {statusFilter === 'open'
            ? '記録された意思決定はありません。「決定を記録」ボタンから追加できます。'
            : '該当する決定はありません。'}
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((d) => {
            const busy = busyId === d.id;
            const CalibIcon = CALIBRATION_META[d.calibration].icon;
            return (
              <div
                key={d.id}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800/50"
              >
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <span
                    className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${CALIBRATION_META[d.calibration].badge}`}
                  >
                    <CalibIcon className="h-2.5 w-2.5" />
                    {CALIBRATION_META[d.calibration].label}
                  </span>
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800">
                    確信度 {Math.round(d.confidence * 100)}%
                  </span>
                  {d.taskId && (
                    <a
                      href={`/tasks/${d.taskId}`}
                      className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 hover:underline dark:bg-emerald-900/30 dark:text-emerald-300"
                    >
                      タスク化済 #{d.taskId}
                    </a>
                  )}
                  {d.reviewDate && (
                    <span className="text-[10px] text-zinc-400">
                      レビュー日 {new Date(d.reviewDate).toLocaleDateString('ja-JP')}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-zinc-400">
                    {new Date(d.createdAt).toLocaleDateString('ja-JP')}
                  </span>
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{d.decision}</p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                  {d.context}
                </p>
                {d.predictedOutcome && (
                  <p className="mt-1 text-[11px] text-indigo-600 dark:text-indigo-400">
                    予想: {d.predictedOutcome}
                  </p>
                )}
                {d.actualOutcome && (
                  <p className="mt-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    実際: {d.actualOutcome}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-700/50">
                  <button
                    onClick={() => openEdit(d)}
                    className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    編集
                  </button>
                  {d.status === 'open' && !d.taskId && (
                    <button
                      onClick={() => handleConvert(d.id)}
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
                  <button
                    onClick={() => handleDelete(d.id)}
                    disabled={busy}
                    title="削除"
                    className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-rose-500 disabled:opacity-50 dark:hover:bg-zinc-800"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
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
