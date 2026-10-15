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
import { Modal } from '@/components/ui/modal/Modal';
import { API_BASE_URL } from '@/utils/api';

/** Matches the backend's MAX_INSTRUCTION_CHARS — an instruction is a sentence. */
const MAX_INSTRUCTION_CHARS = 2000;

interface PlanRevisionRequestProps {
  /** Task whose plan should be revised. / 対象タスクID */
  taskId: number;
  /** Called after the request is accepted, so the caller can refetch. / 受理後の再取得 */
  onRequested?: () => void;
}

/**
 * Trigger button plus the instruction modal.
 *
 * @param props - Task id and post-request callback. / タスクIDと完了コールバック
 * @returns The trigger, and the modal while it is open. / トリガーとモーダル
 */
export function PlanRevisionRequest({ taskId, onRequested }: PlanRevisionRequestProps) {
  const t = useTranslations('workflow');
  const tc = useTranslations('common');
  const [isOpen, setIsOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (submitting) return;
    setIsOpen(false);
    setError(null);
  };

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

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title={t('planRevision.cta')}
        // No vertical padding: this sits in the tab bar's right-hand group next
        // to the reload icon, and any extra height would make the sticky bar
        // taller whenever the plan tab is selected.
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium leading-none text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {t('planRevision.cta')}
      </button>

      <Modal
        open={isOpen}
        onClose={close}
        icon={<MessageSquarePlus className="h-4 w-4 text-indigo-500" />}
        title={t('planRevision.label')}
        maxWidthClass="max-w-xl"
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={submitting}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
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
          </>
        }
      >
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('planRevision.hint')}</p>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          aria-label={t('planRevision.label')}
          rows={5}
          maxLength={MAX_INSTRUCTION_CHARS}
          placeholder={t('planRevision.placeholder')}
          className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        />
        {error && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </Modal>
    </>
  );
}
