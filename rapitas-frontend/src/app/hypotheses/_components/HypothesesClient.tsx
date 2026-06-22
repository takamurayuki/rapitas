'use client';

/**
 * HypothesesClient
 *
 * 仮説台帳の一覧ビュー。エージェントが調査/実装/検証中に起票・証拠記録した仮説を
 * 状態別に表示する。新規作成 UI は持たない（仮説はエージェントが自動起票するため）。
 * 手動の状態上書きと削除のみ提供。
 */
import { useCallback, useEffect, useState } from 'react';
import { Beaker, Trash2, FlaskConical, CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import Pagination from '@/components/ui/pagination/Pagination';

type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive';

interface HypothesisEvidence {
  stance: 'for' | 'against';
  detail: string;
  artifact: string;
  taskId: number | null;
  phase: string | null;
  at: string;
}

interface HypothesisEntry {
  id: number;
  statement: string;
  rationale: string;
  domain: string;
  status: HypothesisStatus;
  confidence: number;
  evidence: HypothesisEvidence[];
  themeId: number | null;
  originTaskId: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Stats {
  open: number;
  supported: number;
  refuted: number;
  inconclusive: number;
}

const STATUS_META: Record<
  HypothesisStatus,
  { label: string; cls: string; Icon: typeof CheckCircle2 }
> = {
  open: { label: '検証待ち', cls: 'bg-blue-100 text-blue-700', Icon: FlaskConical },
  supported: { label: '立証済み', cls: 'bg-green-100 text-green-700', Icon: CheckCircle2 },
  refuted: { label: '反証済み', cls: 'bg-red-100 text-red-700', Icon: XCircle },
  inconclusive: { label: '結論保留', cls: 'bg-amber-100 text-amber-700', Icon: HelpCircle },
};

const FILTERS: { key: HypothesisStatus | 'all'; label: string }[] = [
  { key: 'open', label: '検証待ち' },
  { key: 'supported', label: '立証済み' },
  { key: 'refuted', label: '反証済み' },
  { key: 'inconclusive', label: '結論保留' },
  { key: 'all', label: 'すべて' },
];

export default function HypothesesClient() {
  const [hypotheses, setHypotheses] = useState<HypothesisEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<HypothesisStatus | 'all'>('open');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        limit: String(itemsPerPage),
        offset: String((currentPage - 1) * itemsPerPage),
      });
      const [listRes, statsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/hypotheses?${params}`),
        fetch(`${API_BASE_URL}/hypotheses/stats`),
      ]);
      const list = await listRes.json();
      const s = await statsRes.json();
      setHypotheses(Array.isArray(list?.hypotheses) ? list.hypotheses : []);
      setTotalPages(Math.max(1, Math.ceil((list?.total ?? 0) / itemsPerPage)));
      setStats(s && typeof s.open === 'number' ? s : null);
    } catch {
      setHypotheses([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, currentPage, itemsPerPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (id: number, status: HypothesisStatus) => {
    await fetch(`${API_BASE_URL}/hypotheses/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => {});
    void load();
  };

  const remove = async (id: number) => {
    if (!confirm('この仮説を削除しますか？')) return;
    await fetch(`${API_BASE_URL}/hypotheses/${id}`, { method: 'DELETE' }).catch(() => {});
    void load();
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/30">
          <Beaker className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">仮説</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            エージェントが調査で立てた反証可能な仮説と、証拠・確信度の推移。立証済みは想起時に信頼重み付けされ、反証済みは注入されません。
          </p>
        </div>
      </div>

      {stats && (
        <div className="mb-4 grid grid-cols-4 gap-3">
          {(['open', 'supported', 'refuted', 'inconclusive'] as HypothesisStatus[]).map((k) => (
            <div
              key={k}
              className="rounded-lg border border-zinc-200 bg-white p-3 text-center dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{stats[k]}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{STATUS_META[k].label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setStatusFilter(f.key);
              setCurrentPage(1);
            }}
            className={`rounded-full px-3 py-1 text-sm ${
              statusFilter === f.key
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-zinc-400 dark:text-zinc-500">読み込み中…</div>
      ) : hypotheses.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 py-12 text-center text-zinc-400 dark:border-zinc-700 dark:text-zinc-500">
          仮説がありません。エージェントが調査フェーズで反証可能な仮説を立てると、ここに記録されます。
        </div>
      ) : (
        <ul className="space-y-3">
          {hypotheses.map((h) => (
            <HypothesisCard key={h.id} h={h} onSetStatus={setStatus} onRemove={remove} />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <div className="mt-4">
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
        </div>
      )}
    </div>
  );
}

function HypothesisCard({
  h,
  onSetStatus,
  onRemove,
}: {
  h: HypothesisEntry;
  onSetStatus: (id: number, s: HypothesisStatus) => void;
  onRemove: (id: number) => void;
}) {
  const meta = STATUS_META[h.status];
  const pct = Math.round((h.confidence ?? 0) * 100);
  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${meta.cls}`}
            >
              <meta.Icon className="h-3 w-3" />
              {meta.label}
            </span>
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {h.domain}
            </span>
            {h.originTaskId != null && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                #task {h.originTaskId}
              </span>
            )}
          </div>
          <p className="mt-2 font-medium text-zinc-900 dark:text-zinc-100">{h.statement}</p>
          {h.rationale && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{h.rationale}</p>
          )}
        </div>
        <button
          onClick={() => onRemove(h.id)}
          className="text-zinc-400 hover:text-red-500"
          title="削除"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className={`h-full ${pct >= 80 ? 'bg-green-500' : pct <= 20 ? 'bg-red-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-12 text-right text-xs text-zinc-500 dark:text-zinc-400">
          確信 {pct}%
        </span>
      </div>

      {h.evidence.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-700">
          {h.evidence.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span className={e.stance === 'for' ? 'text-green-600' : 'text-red-600'}>
                {e.stance === 'for' ? '＋' : '−'}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">{e.detail}</span>
              <span className="text-zinc-400 dark:text-zinc-500">（{e.artifact}）</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex gap-2 text-xs">
        {(['supported', 'refuted', 'inconclusive', 'open'] as HypothesisStatus[])
          .filter((s) => s !== h.status)
          .map((s) => (
            <button
              key={s}
              onClick={() => onSetStatus(h.id, s)}
              className="rounded border border-zinc-200 px-2 py-0.5 text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              → {STATUS_META[s].label}
            </button>
          ))}
      </div>
    </li>
  );
}
