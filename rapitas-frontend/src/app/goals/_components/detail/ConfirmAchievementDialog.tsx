'use client';
/**
 * ConfirmAchievementDialog
 *
 * Where the person confirms a milestone (節目) as reached: tick every agreed
 * criterion and write why. Nothing is inferred from task counts — confirming
 * is the person's statement, so the button stays off until both are done.
 */
import { useState } from 'react';
import { Medal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/modal/Modal';
import type { Milestone } from '../../_hooks/goals.types';

interface ConfirmAchievementDialogProps {
  milestone: Pick<Milestone, 'id' | 'name' | 'acceptanceCriteria'>;
  /** Called with the ticked criteria and the evidence. */
  onConfirm: (checkedCriteria: string[], evidence: string) => void;
  onClose: () => void;
  /** A refusal or failure to show (e.g. the criteria changed meanwhile). */
  error?: string | null;
  /** Disables the button while the request is in flight. */
  submitting?: boolean;
}

/**
 * Renders the confirmation dialog for one milestone.
 *
 * @param milestone - The milestone being confirmed / 確認する節目
 * @param onConfirm - Receives ticked criteria and evidence / 確認内容の受け取り
 * @param onClose - Closes without confirming / 閉じる
 * @param error - Error to show / 表示するエラー
 * @param submitting - Whether a request is in flight / 送信中か
 */
export function ConfirmAchievementDialog({
  milestone,
  onConfirm,
  onClose,
  error,
  submitting = false,
}: ConfirmAchievementDialogProps) {
  const t = useTranslations('goals');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState('');

  const toggle = (criterion: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(criterion)) next.delete(criterion);
      else next.add(criterion);
      return next;
    });

  const allChecked = milestone.acceptanceCriteria.every((c) => checked.has(c));
  const canSubmit = allChecked && evidence.trim().length > 0 && !submitting;

  return (
    <Modal
      open
      onClose={onClose}
      icon={<Medal className="h-4 w-4 text-amber-500" />}
      title={t('confirm.title', { name: milestone.name })}
      maxWidthClass="max-w-lg"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              onConfirm(
                milestone.acceptanceCriteria.filter((c) => checked.has(c)),
                evidence.trim(),
              )
            }
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('confirm.submit')}
          </button>
        </>
      }
    >
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">{t('confirm.lead')}</p>
      <ul className="mb-4 space-y-2">
        {milestone.acceptanceCriteria.map((criterion) => (
          <li key={criterion}>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/60">
              <input
                type="checkbox"
                checked={checked.has(criterion)}
                onChange={() => toggle(criterion)}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span className="text-zinc-800 dark:text-zinc-100">{criterion}</span>
            </label>
          </li>
        ))}
      </ul>
      <label
        htmlFor={`evidence-${milestone.id}`}
        className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-200"
      >
        {t('confirm.evidenceLabel')}
      </label>
      <textarea
        id={`evidence-${milestone.id}`}
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder={t('confirm.evidencePlaceholder')}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </Modal>
  );
}
