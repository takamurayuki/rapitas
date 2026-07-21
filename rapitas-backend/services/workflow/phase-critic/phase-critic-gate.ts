/**
 * Phase Critic Gate
 *
 * The enforcing half of the research/plan critic: on a FAIL verdict it archives
 * the artifact (so the orchestrator's reuse-check regenerates it) and rolls the
 * workflow back one phase to re-run the producing role — a bounded self-repair
 * loop mirroring the verify gate. The next run reads buildCriticFeedback() so it
 * fixes the cited issues. Fail-open and bounded: any error, an 'unknown' verdict,
 * or an exhausted bounce budget proceeds without blocking.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { recordTransition } from '../transition-recorder';
import { archiveWorkflowFile } from '../workflow-file-utils';
import { critiquePhase, isPhaseCriticEnabled } from './phase-critic';
import type { CriticPhase } from './phase-critic-types';
import { countWithFailClosed } from '../../../utils/database/fail-closed-count';

const log = createLogger('workflow:phase-critic-gate');

/** Max times a single phase may be bounced by the critic before proceeding. */
const MAX_BOUNCES = 1;

/** Status to roll back to so the producing role re-runs. */
const ROLLBACK: Record<CriticPhase, string> = {
  research: 'draft',
  plan: 'research_done',
};

/** Outcome of the gate. */
export interface PhaseCriticGateResult {
  bounced: boolean;
  /** New workflowStatus when bounced (the rollback target). */
  newStatus?: string;
  /**
   * Why the artifact was rejected, when bounced — surfaced in the save API's
   * HTTP response so the saving agent's own narration (and thus the execution
   * log the user watches) reflects the rollback instead of silently reporting
   * a plain "saved" while the content quietly reverts underneath it.
   */
  reasons?: string[];
  severity?: number;
}

/**
 * Run the critic gate for a freshly-saved research/plan artifact.
 *
 * @param args.taskId - Task being processed. / 対象タスク
 * @param args.phase - 'research' | 'plan'. / フェーズ
 * @param args.content - The saved artifact body. / 保存された本文
 * @param args.currentStatus - The status just set (research_done/plan_created). / 現在の状態
 * @returns Whether the workflow was bounced, and the new status. / バウンス有無と新状態
 */
export async function applyPhaseCriticGate(args: {
  taskId: number;
  phase: CriticPhase;
  content: string;
  currentStatus: string;
}): Promise<PhaseCriticGateResult> {
  const { taskId, phase, content, currentStatus } = args;
  if (!isPhaseCriticEnabled()) return { bounced: false };

  try {
    const result = await critiquePhase(phase, content);
    if (result.verdict !== 'fail') return { bounced: false };

    // FAIL CLOSED: a count error must not read as "0 prior bounces" — that
    // would let this gate keep archiving + rolling back the artifact forever
    // on a recurring DB hiccup instead of respecting MAX_BOUNCES. Treating the
    // budget as exhausted here takes the existing fail-open "proceed" branch
    // below, which is the safe outcome (advisory gate, not a hard block).
    const priorBounces = await countWithFailClosed(
      prisma.workflowTransition.count({ where: { taskId, cause: `${phase}_critic_failed` } }),
      MAX_BOUNCES,
      log,
      { taskId, phase },
      'phase-critic-bounces',
    );

    if (priorBounces >= MAX_BOUNCES) {
      // Budget exhausted — proceed (fail-open) but record that we did.
      await recordTransition({
        taskId,
        fromStatus: currentStatus,
        toStatus: currentStatus,
        actor: 'system',
        cause: `${phase}_critic_exhausted`,
        phase,
        metadata: { severity: result.severity, reasons: result.reasons },
      });
      log.warn(
        { taskId, phase, severity: result.severity },
        '[phase-critic-gate] FAIL but bounce budget exhausted — proceeding',
      );
      return { bounced: false };
    }

    const newStatus = ROLLBACK[phase];

    // Compare-and-swap: only roll back if the workflow is STILL at the status
    // this critic evaluated. The LLM critique takes 60-90s, and a concurrent
    // path can legitimately advance the task meanwhile — observed on task 494:
    // auto-approve flipped plan_created → plan_approved at 00:52:03, then this
    // unguarded rollback stomped it back to research_done at 00:52:12 while
    // the implementer was already being dispatched. A late verdict must not
    // clobber a live state (and must not archive the artifact in use).
    const rolled = await prisma.task.updateMany({
      where: { id: taskId, workflowStatus: currentStatus },
      data: { workflowStatus: newStatus, updatedAt: new Date() },
    });
    if (rolled.count === 0) {
      log.warn(
        { taskId, phase, evaluatedStatus: currentStatus },
        '[phase-critic-gate] FAIL verdict arrived after the workflow moved on — skipping rollback',
      );
      return { bounced: false };
    }

    await archiveWorkflowFile(taskId, phase);

    await recordTransition({
      taskId,
      fromStatus: currentStatus,
      toStatus: newStatus,
      actor: 'system',
      cause: `${phase}_critic_failed`,
      phase,
      metadata: { severity: result.severity, reasons: result.reasons },
      invariantViolation: true,
      invariantMessage: `${phase}.md は批評ゲート不合格のため再生成します`,
    });
    log.warn(
      { taskId, phase, severity: result.severity, reasons: result.reasons.slice(0, 3) },
      '[phase-critic-gate] FAIL — archived artifact and rolled back for regeneration',
    );
    return { bounced: true, newStatus, reasons: result.reasons, severity: result.severity };
  } catch (err) {
    log.warn({ err, taskId, phase }, '[phase-critic-gate] gate errored — proceeding (fail-open)');
    return { bounced: false };
  }
}

/**
 * Build the "address these critic issues" feedback section for the regenerating
 * researcher/planner. Empty string when there is no prior critic failure.
 *
 * @param taskId - Task being regenerated. / 対象タスク
 * @param phase - 'research' | 'plan'. / フェーズ
 * @param language - Output language. / 出力言語
 * @returns Markdown feedback section, or ''. / 批評フィードバックの節
 */
export async function buildCriticFeedback(
  taskId: number,
  phase: CriticPhase,
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const last = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: `${phase}_critic_failed` },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (!last?.metadata) return '';
    let reasons: string[] = [];
    try {
      const meta = JSON.parse(last.metadata) as { reasons?: unknown };
      if (Array.isArray(meta.reasons)) {
        reasons = meta.reasons.filter((r): r is string => typeof r === 'string');
      }
    } catch {
      return '';
    }
    if (reasons.length === 0) return '';
    const header =
      language === 'en'
        ? '# Critic feedback to address (previous attempt was rejected)'
        : '# 批評ゲートの指摘（前回は不合格 — 必ず対応すること）';
    return `${header}\n\n${reasons.map((r) => `- ${r}`).join('\n')}`;
  } catch {
    return '';
  }
}
