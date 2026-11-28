/**
 * Phase Critic Gate Context
 *
 * Reads what surrounds a critique: the grounding handed to the lenses and the
 * feedback handed back to the regenerating role. Not responsible for deciding
 * whether to bounce (phase-critic-gate.ts).
 */
import { prisma } from '../../../config/database';
import { resolveAcceptanceCriteria } from '../../agents/verification/acceptance-self-check';
import type { CriticContext } from './phase-critic.input';
import type { CriticPhase } from './phase-critic-types';

/**
 * Collect best-effort grounding for the critic: the task's title/description,
 * its acceptance criteria (task 911 — previously never sent, so the gate had
 * no way to see requirements the artifact failed to address), the prior-phase
 * document (research.md when critiquing a plan), and the reasons of this
 * phase's previous critic rejection. Every lookup fails open — a DB hiccup
 * degrades to the old artifact-only critique instead of blocking.
 *
 * @param taskId - Task being critiqued. / 対象タスク
 * @param phase - 'research' | 'plan'. / フェーズ
 * @returns Context, or undefined when nothing could be gathered. / 収集結果
 */
export async function gatherCriticContext(
  taskId: number,
  phase: CriticPhase,
): Promise<CriticContext | undefined> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { title: true, description: true, acceptanceCriteria: true },
    });
    if (!task) return { unavailable: true };
    const taskBrief = task ? `${task.title}\n\n${task.description ?? ''}`.trim() : undefined;
    const acceptanceCriteria = task
      ? resolveAcceptanceCriteria({
          acceptanceCriteria: task.acceptanceCriteria,
          description: task.description,
        })
      : [];

    let referenceArtifact: string | undefined;
    if (phase === 'plan') {
      const research = await prisma.workflowFile.findFirst({
        where: { taskId, fileType: 'research' },
        select: { content: true },
      });
      referenceArtifact = research?.content || undefined;
    }

    let priorReasons: string[] | undefined;
    const last = await prisma.workflowTransition.findFirst({
      where: { taskId, cause: `${phase}_critic_failed` },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    });
    if (last?.metadata) {
      try {
        const meta = JSON.parse(last.metadata) as { reasons?: unknown };
        if (Array.isArray(meta.reasons)) {
          priorReasons = meta.reasons.filter((r): r is string => typeof r === 'string');
        }
      } catch {
        // Malformed metadata — critique proceeds without the convergence rule.
      }
    }

    if (
      !taskBrief &&
      !referenceArtifact &&
      !priorReasons?.length &&
      acceptanceCriteria.length === 0
    )
      return undefined;
    return {
      taskBrief,
      referenceArtifact,
      priorReasons,
      acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
    };
  } catch {
    return { unavailable: true }; // Preserve missing grounding as incomplete evidence.
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
