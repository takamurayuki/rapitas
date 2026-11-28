/**
 * useCriticRejection
 *
 * Fetches the phase-critic rejection that rolled the workflow back to its
 * current status. Not responsible for rendering the banner.
 */
import { useEffect, useState } from 'react';
import type { WorkflowStatus } from '@/types';
import { API_BASE_URL } from '@/utils/api';

export interface CriticRejection {
  phase: 'research' | 'plan';
  reasons: string[];
  severity: number | null;
}

/**
 * The phase-critic gate can silently archive a freshly-saved research.md /
 * plan.md and roll workflowStatus back a step (research_done → draft,
 * plan_created → research_done) when it fails quality review — a bounded
 * self-repair loop (see phase-critic-gate.ts). Without this, the file just
 * vanishes from the viewer and the status regresses with no visible
 * explanation. The rejection is returned whenever the CURRENT status is exactly
 * the rollback target of the latest such transition (i.e. nothing has superseded
 * it yet — a fresh save moves the status forward and it stops matching).
 *
 * @param taskId - Task being shown / 表示中のタスクID
 * @param currentWorkflowStatus - Current workflow status / 現在の状態
 * @returns The active rejection, or null / 有効な却下情報
 */
export function useCriticRejection(
  taskId: number,
  currentWorkflowStatus: WorkflowStatus | null,
): CriticRejection | null {
  const [criticRejection, setCriticRejection] = useState<CriticRejection | null>(null);

  useEffect(() => {
    if (
      !taskId ||
      (currentWorkflowStatus !== 'draft' && currentWorkflowStatus !== 'research_done')
    ) {
      setCriticRejection(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/workflow/tasks/${taskId}/transitions`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          success?: boolean;
          transitions?: Array<{
            cause?: string | null;
            toStatus?: string | null;
            metadata?: { reasons?: unknown; severity?: unknown };
          }>;
        };
        if (cancelled || !data.success || !data.transitions?.length) return;
        const latest = data.transitions[data.transitions.length - 1];
        const phase =
          latest?.cause === 'research_critic_failed'
            ? 'research'
            : latest?.cause === 'plan_critic_failed'
              ? 'plan'
              : null;
        if (!phase || latest?.toStatus !== currentWorkflowStatus) {
          setCriticRejection(null);
          return;
        }
        const reasons = Array.isArray(latest.metadata?.reasons)
          ? latest.metadata!.reasons.filter((r): r is string => typeof r === 'string')
          : [];
        const severity =
          typeof latest.metadata?.severity === 'number' ? latest.metadata.severity : null;
        setCriticRejection({ phase, reasons, severity });
      } catch {
        // Non-fatal — the banner simply doesn't show.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, currentWorkflowStatus]);

  return criticRejection;
}
