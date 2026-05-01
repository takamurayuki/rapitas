/**
 * ProgressSummaryService
 *
 * Generates AI-powered progress summaries from completed tasks.
 * Uses local LLM (Ollama/llama-server) for cost-free summarization.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { getTaskWorkflowDir } from '../workflow/workflow-paths';

const log = createLogger('progress-summary');

/** Generated progress summary. */
export type ProgressSummary = {
  period: string;
  generatedAt: Date;
  completedCount: number;
  totalHours: number;
  summary: string;
  highlights: string[];
  tasksById: Array<{ id: number; title: string; completedAt: Date }>;
};

/**
 * Generate a progress summary for completed tasks within a date range.
 *
 * @param days - Number of days to look back / 振り返る日数
 * @returns Progress summary / 進捗サマリー
 */
export async function generateProgressSummary(days: number = 7): Promise<ProgressSummary> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const completedTasks = await prisma.task.findMany({
    where: {
      status: 'done',
      updatedAt: { gte: since },
    },
    include: { theme: true },
    orderBy: { updatedAt: 'desc' },
  });

  const totalHours = completedTasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);

  // Collect verify.md content for each task
  const taskDetails: string[] = [];
  for (const task of completedTasks.slice(0, 10)) {
    const verifyContent = await readVerifyFile(task.id, task.themeId, task.theme?.categoryId);
    const detail = verifyContent
      ? `- #${task.id} ${task.title}: ${extractFirstLine(verifyContent)}`
      : `- #${task.id} ${task.title}`;
    taskDetails.push(detail);
  }

  // NOTE: Use template-based summary (no LLM call). LLM summarization was removed because
  // the small local model (Qwen 0.5B) frequently times out and the template output is sufficient.
  const summary = buildTemplateSummary(completedTasks.length, totalHours, days);
  const highlights = taskDetails.slice(0, 3);

  return {
    period: `${days}日間`,
    generatedAt: new Date(),
    completedCount: completedTasks.length,
    totalHours: Math.round(totalHours * 10) / 10,
    summary,
    highlights,
    tasksById: completedTasks.map((t) => ({
      id: t.id,
      title: t.title,
      completedAt: t.updatedAt,
    })),
  };
}

function buildTemplateSummary(count: number, hours: number, days: number): string {
  return `過去${days}日間で${count}件のタスクを完了しました（合計${hours.toFixed(1)}時間）。`;
}

async function readVerifyFile(
  taskId: number,
  themeId: number | null,
  categoryId: number | null | undefined,
): Promise<string | null> {
  try {
    const taskDir = getTaskWorkflowDir(categoryId ?? null, themeId, taskId);
    const filePath = join(taskDir, 'verify.md');
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractFirstLine(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  return firstLine?.trim().slice(0, 100) || '';
}
