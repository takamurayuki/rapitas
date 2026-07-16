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
import { addNode, addEdge } from './knowledge-graph';

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
export function taskTypeLabel(title: string): string {
  const m = title.match(/^\s*\[([^\]]{1,24})\]/);
  return (m ? m[1].trim() : 'general') || 'general';
}

/**
 * Confidence penalty per WorkflowTransition trouble cause. The codes mirror
 * role-evidence.ts's gate-rejection causes: each one means a verification gate
 * bounced the work at least once, so the lesson learned from the task is less
 * trustworthy than a clean first-pass outcome.
 */
const TROUBLE_WEIGHTS: Record<string, number> = {
  verify_repair: 0.15,
  adversarial_review_failed: 0.12,
  ci_repair: 0.1,
  verify_validation_failed: 0.08,
  verify_no_changes: 0.08,
  log_polluted_rejected: 0.05,
  plan_invalid: 0.05,
};

/**
 * Derive an outcome confidence from the task's actual gate history instead of
 * a constant. The previous hardcoded `success ? 0.8 : 0.2` made the memory
 * page's confidence trend flatline at exactly 80% forever (the chart averages
 * completed experiments, which all carried the same 0.8).
 *
 * @param taskId - Task whose transition history to inspect. / 対象タスク
 * @param success - Whether the task completed successfully. / 成功したか
 * @returns Confidence in [0.05, 0.95] plus the distinct trouble causes seen. / 信頼度と障害要因
 */
export async function deriveOutcomeConfidence(
  taskId: number,
  success: boolean,
): Promise<{ confidence: number; troubleCauses: string[] }> {
  try {
    const rows = await prisma.workflowTransition.findMany({
      where: { taskId, cause: { in: Object.keys(TROUBLE_WEIGHTS) } },
      select: { cause: true },
    });
    const causes = rows.map((r) => r.cause).filter((c): c is string => !!c);
    const penalty = causes.reduce((sum, c) => sum + (TROUBLE_WEIGHTS[c] ?? 0), 0);
    const confidence = success
      ? Math.max(0.35, Math.min(0.95, 0.95 - penalty))
      : Math.max(0.05, Math.min(0.25, 0.25 - 0.02 * causes.length));
    return { confidence, troubleCauses: [...new Set(causes)] };
  } catch {
    // Legacy constants as a fallback — telemetry must never block the outcome.
    return { confidence: success ? 0.8 : 0.2, troubleCauses: [] };
  }
}

/**
 * Canonical technology labels extracted from task titles. First-match order;
 * capped at 3 per task so one verbose title can't flood the graph.
 */
const TECH_KEYWORDS: Array<[RegExp, string]> = [
  [/next\.?js/i, 'Next.js'],
  [/react/i, 'React'],
  [/tauri/i, 'Tauri'],
  [/prisma/i, 'Prisma'],
  [/postgres/i, 'PostgreSQL'],
  [/sqlite/i, 'SQLite'],
  [/typescript|\btsc\b/i, 'TypeScript'],
  [/eslint|\blint\b/i, 'ESLint'],
  [/vitest|bun test|テスト/i, 'testing'],
  [/tailwind|\bcss\b/i, 'CSS'],
  [/websocket/i, 'WebSocket'],
  [/\bsse\b/i, 'SSE'],
  [/git(hub)?\b|\bpr\b|プルリク/i, 'Git'],
  [/\bci\b/i, 'CI'],
  [/i18n|翻訳/i, 'i18n'],
  [/llm|ollama|claude|エージェント|agent/i, 'LLM'],
  [/\bapi\b/i, 'API'],
  [/\bui\b|画面|モーダル|ダッシュボード/i, 'UI'],
];

/** Extract up to 3 canonical technology labels from a task title. */
export function extractTechLabels(title: string): string[] {
  const labels: string[] = [];
  for (const [pattern, label] of TECH_KEYWORDS) {
    if (labels.length >= 3) break;
    if (pattern.test(title) && !labels.includes(label)) labels.push(label);
  }
  return labels;
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

    const { confidence, troubleCauses } = await deriveOutcomeConfidence(taskId, success);

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
      confidence,
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

    // Knowledge-graph nodes (addNode upserts + reinforces weight, so the graph
    // grows toward what the agent works on most). Multiple node TYPES are
    // written on purpose: a concept-only writer made the memory page's
    // knowledge-distribution chart read "concept 100%" permanently.
    // concept: what kind of task this was.
    const conceptNode = await addNode({
      label: taskTypeLabel(title),
      nodeType: 'concept',
      description: `タスク種別「${taskTypeLabel(title)}」`,
      weight: success ? 0.2 : 0.1,
    });
    // technology: what the task touched (dictionary match on the title).
    const techNodes = [];
    for (const tech of extractTechLabels(title)) {
      techNodes.push(
        await addNode({
          label: tech,
          nodeType: 'technology',
          description: `技術要素「${tech}」`,
          weight: success ? 0.15 : 0.05,
        }),
      );
    }
    // pattern: which workflow mode handled it.
    if (task.workflowMode) {
      await addNode({
        label: `mode:${task.workflowMode}`,
        nodeType: 'pattern',
        description: `ワークフローモード「${task.workflowMode}」での実行`,
        weight: success ? 0.15 : 0.05,
      });
    }
    // problem: which verification gates bounced the work (stable cause codes).
    const problemNodes = [];
    for (const cause of troubleCauses.slice(0, 3)) {
      problemNodes.push(
        await addNode({
          label: cause,
          nodeType: 'problem',
          description: `検証ゲート却下要因「${cause}」`,
          weight: 0.15,
        }),
      );
    }
    if (!success) {
      problemNodes.push(
        await addNode({
          label: `failed:${finalStatus}`,
          nodeType: 'problem',
          description: `終端ステータス「${finalStatus}」での失敗`,
          weight: 0.15,
        }),
      );
    }
    // Edges make the graph QUERYABLE: "which problems does this task type /
    // technology run into" is what the implementer's pitfall warning reads.
    // Nodes alone (global counters) can't answer that correlation.
    for (const problem of problemNodes) {
      await addEdge({
        fromNodeId: conceptNode.id,
        toNodeId: problem.id,
        edgeType: 'causes',
        weight: 0.2,
      });
      for (const tech of techNodes) {
        await addEdge({
          fromNodeId: tech.id,
          toNodeId: problem.id,
          edgeType: 'causes',
          weight: 0.15,
        });
      }
    }
    // solution: the self-repair loop recovered a troubled task to success.
    if (success && troubleCauses.length > 0) {
      const solutionNode = await addNode({
        label: 'self_repair_recovery',
        nodeType: 'solution',
        description: '検証ゲート却下から自己修復して完了',
        weight: 0.2,
      });
      for (const problem of problemNodes) {
        await addEdge({
          fromNodeId: solutionNode.id,
          toNodeId: problem.id,
          edgeType: 'solves',
          weight: 0.2,
        });
      }
    }

    log.info(
      { taskId, experimentId, success, confidence, troubleCauses },
      '[task-recorder] learning artifacts recorded',
    );
  } catch (err) {
    log.warn({ err, taskId }, '[task-recorder] failed to record learning artifacts');
  }
}
