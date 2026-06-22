/**
 * task-learning-recorder
 *
 * Bridges the auto-run workflow into the self-learning subsystem: on each task's
 * terminal outcome it records ONE Experiment (per task), an evaluate-phase
 * Episode, and a concept KnowledgeGraphNode. Without this the experiment /
 * episode / knowledge-graph tables stayed empty (only LearningPattern was ever
 * written), so the agent-memory page showed knowledge-nodes / episodic-memory at
 * 0 and success-rate (= completedExperiments / totalExperiments) permanently 0.
 * Not responsible for the LearningPattern path, which is wired elsewhere.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { saveEpisode } from './episode-memory';
import { addNode } from './knowledge-graph';

const log = createLogger('self-learning:task-recorder');

/** Minimal task fields needed to summarise an outcome. */
export interface TaskOutcomeInfo {
  title?: string | null;
  themeId?: number | null;
  workflowMode?: string | null;
  complexityScore?: number | null;
}

/**
 * Derive a concept label from a task title's `[Type]` prefix (e.g. "[Refactor]
 * …" → "Refactor"); falls back to "general" when no prefix is present.
 *
 * @param title - The task title. / タスクタイトル
 * @returns A short concept label. / 概念ラベル
 */
function taskTypeLabel(title: string): string {
  const m = title.match(/^\s*\[([^\]]{1,24})\]/);
  return (m ? m[1].trim() : 'general') || 'general';
}

/**
 * Record the self-learning artifacts for a task's terminal outcome.
 *
 * Upserts a single Experiment per taskId (so re-runs update rather than
 * double-count), logs an evaluate Episode, and reinforces a concept node.
 * Best-effort: never throws — a telemetry hiccup must not affect the workflow.
 *
 * @param taskId - The task that reached a terminal state. / 終端に達したタスク
 * @param finalStatus - Terminal status ("completed" → success, else failure). / 終端ステータス
 * @param task - Minimal task metadata for the summary. / 要約用メタdata
 * @returns Resolves when recording is done (or safely skipped). / 記録完了で解決
 */
export async function recordTaskLearningArtifacts(
  taskId: number,
  finalStatus: string,
  task: TaskOutcomeInfo,
): Promise<void> {
  try {
    const success = finalStatus === 'completed';
    const title = task.title?.trim() || `Task #${taskId}`;
    const metadata = JSON.stringify({
      themeId: task.themeId ?? null,
      workflowMode: task.workflowMode ?? null,
      complexityScore: task.complexityScore ?? null,
    });

    // One Experiment per task: success rate on the memory page is
    // completedExperiments / totalExperiments, so a per-task experiment makes it
    // track real task outcomes. Upsert by taskId so a re-run updates the verdict
    // instead of inflating the totals.
    const existing = await prisma.experiment
      .findFirst({ where: { taskId }, select: { id: true } })
      .catch(() => null);
    const data = {
      taskId,
      title,
      status: success ? 'completed' : 'failed',
      confidence: success ? 0.8 : 0.2,
      completedAt: new Date(),
      metadata,
    };
    const experimentId = existing
      ? (await prisma.experiment.update({ where: { id: existing.id }, data, select: { id: true } }))
          .id
      : (await prisma.experiment.create({ data, select: { id: true } })).id;

    // Evaluate-phase episode capturing the outcome (populates episodic memory).
    await saveEpisode({
      experimentId,
      phase: 'evaluate',
      content: `${title} — ${success ? '完了' : `終了(${finalStatus})`}`,
      context: { taskId, themeId: task.themeId ?? null },
      outcome: success ? 'success' : 'failure',
      emotionalTag: success ? 'satisfying' : 'frustrating',
      importance: success ? 0.6 : 0.7,
    });

    // Concept node for the task type (addNode upserts + reinforces weight, so the
    // graph grows toward what the agent works on most).
    await addNode({
      label: taskTypeLabel(title),
      nodeType: 'concept',
      description: `タスク種別「${taskTypeLabel(title)}」`,
      weight: success ? 0.2 : 0.1,
    });

    log.info({ taskId, experimentId, success }, '[task-recorder] learning artifacts recorded');
  } catch (err) {
    log.warn({ err, taskId }, '[task-recorder] failed to record learning artifacts');
  }
}
