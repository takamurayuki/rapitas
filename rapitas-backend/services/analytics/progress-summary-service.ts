/**
 * ProgressSummaryService
 *
 * Generates AI-powered progress summaries from completed tasks.
 * Uses local LLM (Ollama/llama-server) for cost-free summarization.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { ensureLocalLLM } from '../local-llm/local-llm-manager';
import { callOllama } from '../../utils/ai-client/ollama-provider';
import { readFile } from 'fs/promises';
import { join } from 'path';

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

  let summary: string;
  let highlights: string[];

  try {
    const { url, model } = await ensureLocalLLM();
    const aiResult = await generateAISummary(url, model, taskDetails, days, completedTasks.length, totalHours);
    summary = aiResult.summary;
    highlights = aiResult.highlights;
  } catch (error) {
    // NOTE: LLM unavailable — fall back to template-based summary
    log.warn({ err: error }, '[ProgressSummary] LLM unavailable, using template');
    summary = buildTemplateSummary(completedTasks.length, totalHours, days);
    highlights = taskDetails.slice(0, 3);
  }

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

/**
 * Generate AI-powered summary using local LLM.
 */
async function generateAISummary(
  url: string,
  model: string,
  taskDetails: string[],
  days: number,
  count: number,
  hours: number,
): Promise<{ summary: string; highlights: string[] }> {
  const prompt = `以下は過去${days}日間に完了したタスク一覧です（${count}件、合計${hours.toFixed(1)}時間）：

${taskDetails.join('\n')}

上記を3-5行で要約し、主要な成果を3つのハイライトとしてまとめてください。

出力形式:
SUMMARY: (要約テキスト)
HIGHLIGHT: (成果1)
HIGHLIGHT: (成果2)
HIGHLIGHT: (成果3)`;

  const result = await callOllama(url, model, [{ role: 'user', content: prompt }], undefined, 512);

  const lines = result.content.split('\n');
  const summaryLine = lines.find((l) => l.startsWith('SUMMARY:'));
  const highlightLines = lines.filter((l) => l.startsWith('HIGHLIGHT:'));

  return {
    summary: summaryLine?.replace('SUMMARY:', '').trim() || result.content.slice(0, 300),
    highlights: highlightLines.length > 0
      ? highlightLines.map((l) => l.replace('HIGHLIGHT:', '').trim())
      : [result.content.slice(0, 100)],
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
    const catDir = categoryId ? String(categoryId) : '0';
    const thDir = themeId ? String(themeId) : '0';
    const filePath = join(process.cwd(), 'tasks', catDir, thDir, String(taskId), 'verify.md');
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function extractFirstLine(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  return firstLine?.trim().slice(0, 100) || '';
}
