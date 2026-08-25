'use client';

/**
 * PlanRevisionRequest
 *
 * Lets a human ask the PLANNER to change plan.md instead of editing the
 * document by hand: one sentence in, a targeted revision out.
 *
 * Editing a plan manually means reading the whole document to change one line,
 * and leaves no record of why it changed — while the plan is the contract the
 * verify and adversarial gates judge the implementer against. This posts the
 * instruction instead, which is recorded as a transition and applied by the
 * planner.
 *
 * Not responsible for approving or rejecting the plan — that stays with the
 * approval controls.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquarePlus } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

interface PlanRevisionRequestProps {
  /** Task whose plan should be revised. / 対象タスクID */
  taskId: number;
  /** Called after the request is accepted, so the caller can refetch. / 受理後の再取得 */
  onRequested?: () => void;
}

/**
 * Instruction box that sends a plan-revision request to the planner.
 *
 * @param props - Task id and post-request callback. / タスクIDと完了コールバック
 * @returns The collapsed CTA, or the open instruction form. / CTAまたは入力フォーム
 */
export function PlanRevisionRequest({ taskId, onRequested }: PlanRevisionRequestProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/revise-plan`, {
        method: 'POST',
        // The backend rejects this without the source header, so an agent
        // cannot hand itself a revised plan through a shell call.
        headers: { 'Content-Type': 'application/json', 'X-Rapitas-Source': 'ui' },
        body: JSON.stringify({ instruction: trimmed }),
      });
      if (!res.ok) {
        setError(t('planRevision.failed'));
        return;
      }
      setInstruction('');
      setIsOpen(false);
      onRequested?.();
    } catch {
      setError(t('planRevision.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t('planRevision.cta')}
      </button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <label
        htmlFor={`plan-revision-${taskId}`}
        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        {t('planRevision.label')}
      </label>
      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{t('planRevision.hint')}</p>
      <textarea
        id={`plan-revision-${taskId}`}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        aria-label={t('planRevision.label')}
        rows={3}
        maxLength={2000}
        placeholder={t('planRevision.placeholder')}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {error && <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          {tc('cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!instruction.trim() || submitting}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? t('planRevision.submitting') : t('planRevision.submit')}
        </button>
      </div>
    </div>
  );
}
