/**
 * useBlockedCauseLabel
 *
 * Fetches why a blocked task stopped and returns it as display text.
 * Not responsible for rendering or for deciding whether the task is blocked.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import {
  blockedCauseFromTransitions,
  resolveBlockedCauseLabel,
  type BlockedCauseTransition,
} from '@/components/workflow/workflow-blocked-cause';

/**
 * Lazily (only while blocked) read the cause from the append-only
 * WorkflowTransition log, since it isn't on the Task object itself.
 *
 * @param taskId - Task being shown / 表示中のタスクID
 * @param isBlocked - Whether the task is blocked / ブロック中か
 * @returns Localized cause, or null (the pill then shows the generic hint) / 表示文言
 */
export function useBlockedCauseLabel(taskId: number, isBlocked: boolean): string | null {
  const t = useTranslations('workflow');
  const [blockedCause, setBlockedCause] = useState<string | null>(null);

  useEffect(() => {
    if (!isBlocked || !taskId) {
      setBlockedCause(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          transitions?: BlockedCauseTransition[];
        };
        if (cancelled || !data.success || !data.transitions?.length) return;
        const label = resolveBlockedCauseLabel(t, blockedCauseFromTransitions(data.transitions));
        if (label) setBlockedCause(label);
      } catch {
        // Non-fatal — the pill falls back to the generic hint.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBlocked, taskId, t]);

  return blockedCause;
}
