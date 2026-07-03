'use client';
/**
 * JudgeEvalCard
 *
 * Surfaces the latest result of the adversarial-judge accuracy eval
 * (`scripts/eval-judge.ts`, opt-in via RAPITAS_EVAL_JUDGE=1 — it makes live
 * LLM calls so it never runs in CI by default). Without this card the eval's
 * result was only visible in a terminal that ran it manually; now it reads
 * the persisted snapshot from GET /agent-metrics/judge-eval and shows an
 * explicit empty state when the eval has never run, rather than silently
 * disappearing like RepairConvergenceCard does for its zero-data case.
 */
import { useEffect, useState } from 'react';
import { Gavel, CheckCircle2, XCircle, AlertTriangle, HelpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';

interface JudgeEvalCaseResult {
  name: string;
  expected: 'pass' | 'fail';
  got: 'pass' | 'fail' | 'unknown';
  ok: boolean;
}

interface JudgeEvalResult {
  timestamp: string;
  provider: string;
  correct: number;
  total: number;
  errored: number;
  accuracy: number;
  minAccuracy: number;
  passed: boolean;
  cases: JudgeEvalCaseResult[];
}

export function JudgeEvalCard() {
  const t = useTranslations('agents');
  const [data, setData] = useState<JudgeEvalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/agent-metrics/judge-eval`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { success: boolean; data: JudgeEvalResult | null };
      })
      .then((v) => {
        if (cancelled) return;
        if (!v.success) {
          setLoadFailed(true);
          return;
        }
        setData(v.data);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return null;

  return (
    <div className="mb-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        <Gavel className="h-4 w-4 text-zinc-400" />
        {t('judgeEval.title')}
      </h3>

      {loadFailed ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {t('judgeEval.loadFailed')}
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
          {t('judgeEval.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-2 divide-x divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white md:grid-cols-4 md:divide-y-0 dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-800">
          <div className="flex items-center gap-3 px-4 py-3">
            {data.passed ? (
              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 shrink-0 text-red-500" />
            )}
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
                {(data.accuracy * 100).toFixed(0)}%
              </div>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {t('judgeEval.accuracy')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
                {data.correct}/{data.total}
              </div>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {t(data.passed ? 'judgeEval.passed' : 'judgeEval.failed')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xl font-bold leading-tight text-zinc-900 dark:text-zinc-50">
                {data.provider}
              </div>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {t('judgeEval.provider')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-3">
            {data.errored > 0 && <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium leading-tight text-zinc-900 dark:text-zinc-50">
                {new Date(data.timestamp).toLocaleString()}
              </div>
              <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                {data.errored > 0
                  ? t('judgeEval.errored', { count: data.errored })
                  : t('judgeEval.lastRun')}
              </p>
            </div>
          </div>
        </div>
      )}

      {data && data.cases.length > 0 && (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('judgeEval.caseBreakdown')}
          </p>
          <div className="flex flex-wrap gap-2">
            {data.cases.map((c) => (
              <span
                key={c.name}
                title={`expected: ${c.expected} / got: ${c.got}`}
                className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs ${
                  c.ok
                    ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : c.got === 'unknown'
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                      : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                }`}
              >
                {c.ok ? (
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                ) : c.got === 'unknown' ? (
                  <HelpCircle className="h-3 w-3 shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 shrink-0" />
                )}
                {c.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
