/**
 * ReviewHoldPanel
 *
 * Shows a task's review hold (the diff review could not be settled and a human
 * must decide) with the two resolutions the backend accepts: accept the
 * findings (→ repair) or override (→ commit/PR, automated checks still run).
 * Fetches GET /workflow/tasks/:id/review-hold itself and renders nothing when
 * the task is not held. NOT responsible for the review history list.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { JuryFindingRow } from './JuryFindingRow';
import type { AwaitingHuman, DisplayFinding, RawTimelineEvent } from './review-history';
import { deriveJuryReviewHistory } from './review-history';

type Action = 'accept' | 'override';

interface HoldState {
  reason: AwaitingHuman['reason'];
  detail: string;
  findings: DisplayFinding[];
}

/** Reuse the timeline normaliser so findings render exactly like the history. */
function toHoldState(raw: Record<string, unknown>): HoldState {
  const [entry] = deriveJuryReviewHistory([
    {
      eventType: 'adversarial_review',
      payload: { verdict: 'hold', findings: raw.findings },
    } satisfies RawTimelineEvent,
  ]);
  return {
    reason:
      raw.reason === 'unresolved_dispute' ? 'unresolved_dispute' : 'jury_unavailable_high_risk',
    detail: typeof raw.detail === 'string' ? raw.detail : '',
    findings: entry?.findings ?? [],
  };
}

/**
 * Review-hold notice with the accept / override actions.
 *
 * @param taskId - Task to check / 対象タスク
 * @param onResolved - Called after a successful resolution / 解消後のコールバック
 * @returns The panel, or null when not held / 保留中でなければ null
 */
export default function ReviewHoldPanel({
  taskId,
  onResolved,
}: {
  taskId: number;
  onResolved?: (action: Action) => void;
}) {
  const t = useTranslations('workflow');
  const k = 'taskWorkflowSection.criticHistory';
  const [hold, setHold] = useState<HoldState | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/review-hold`);
      if (!res.ok) return;
      const data = (await res.json()) as { held?: boolean; hold?: Record<string, unknown> | null };
      setHold(data.held && data.hold ? toHoldState(data.hold) : null);
    } catch {
      // Auxiliary display — a failed read just hides the panel.
    }
  }, [taskId]);

  useEffect(() => {
    if (taskId) void load();
  }, [taskId, load]);

  const resolve = async (action: Action) => {
    if (busy) return;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/review-hold/resolve`, {
        method: 'POST',
        // The backend refuses this without the source header, so an agent
        // cannot wave its own disputed change through with a shell call.
        headers: { 'Content-Type': 'application/json', 'X-Rapitas-Source': 'ui' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setMessage({ ok: false, text: t(`${k}.reviewHold.failed`) });
        return;
      }
      setHold(null);
      setMessage({ ok: true, text: t(`${k}.reviewHold.done.${action}`) });
      onResolved?.(action);
    } catch {
      setMessage({ ok: false, text: t(`${k}.reviewHold.failed`) });
    } finally {
      setBusy(null);
    }
  };

  if (!hold) {
    return message?.ok ? (
      <p className="px-4 pt-3 text-xs text-emerald-700 dark:text-emerald-300">{message.text}</p>
    ) : null;
  }

  return (
    <div className="mx-4 mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 dark:border-amber-800/60 dark:bg-amber-900/20">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
        {t(`${k}.reviewHold.title`)}
      </p>
      <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
        {t(`${k}.jury.awaiting.${hold.reason}`)}
        {hold.detail ? `: ${hold.detail}` : ''}
      </p>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{t(`${k}.reviewHold.hint`)}</p>
      {hold.findings.length > 0 && (
        <ul className="mt-3 space-y-3">
          {hold.findings.map((f, i) => (
            <JuryFindingRow key={i} f={f} />
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => resolve('accept')}
          disabled={busy !== null}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'accept' ? t(`${k}.reviewHold.submitting`) : t(`${k}.reviewHold.accept`)}
        </button>
        <button
          type="button"
          onClick={() => resolve('override')}
          disabled={busy !== null}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
        >
          {busy === 'override' ? t(`${k}.reviewHold.submitting`) : t(`${k}.reviewHold.override`)}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {t(`${k}.reviewHold.overrideHint`)}
      </p>
      {message && !message.ok && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{message.text}</p>
      )}
    </div>
  );
}
