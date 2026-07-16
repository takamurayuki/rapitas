'use client';
/**
 * PromptEvolutionProposals
 *
 * Human-approval gate for the prompt-evolution pipeline: the weekly worker
 * generates role-prompt improvement addenda for underperforming workflow
 * roles, and NOTHING is injected into agent prompts until a human approves it
 * here. Approving supersedes the role's previously approved addendum.
 */
import { useEffect, useState } from 'react';
import { GitBranchPlus, Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('PromptEvolutionProposals');

interface Proposal {
  id: number;
  basePromptKey: string | null;
  category: string;
  reason: string | null;
  afterPrompt: string;
  createdAt: string;
}

export function PromptEvolutionProposals() {
  const t = useTranslations('prompts.promptEvolution.proposals');
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE_URL}/learning/prompt-evolution/proposals`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { proposals: Proposal[] } | null) => {
        if (!cancelled && v) setProposals(v.proposals);
      })
      .catch((err) => logger.error('Failed to fetch proposals:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const review = async (id: number, approved: boolean) => {
    setBusyId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/learning/prompt-evolution/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
      });
      if (res.ok) {
        setProposals((prev) => prev.filter((p) => p.id !== id));
      }
    } catch (err) {
      logger.error('Failed to review proposal:', err);
    } finally {
      setBusyId(null);
    }
  };

  if (proposals.length === 0) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
        <GitBranchPlus className="h-4 w-4 text-zinc-400" />
        {t('title')}
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
          {proposals.length}
        </span>
      </h2>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('hint')}</p>

      <div className="space-y-3">
        {proposals.map((p) => {
          const role = p.basePromptKey?.replace(/^workflow_role_/, '') || p.category;
          return (
            <div
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {t('roleLabel', { role })}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => review(p.id, true)}
                    className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('approve')}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => review(p.id, false)}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <X className="h-3.5 w-3.5" />
                    {t('reject')}
                  </button>
                </div>
              </div>
              {p.reason && (
                <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('reasonLabel')}: {p.reason}
                </p>
              )}
              <pre className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
                {p.afterPrompt}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
