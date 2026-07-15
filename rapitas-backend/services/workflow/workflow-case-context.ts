/**
 * Workflow Case Context (R9 — case-based reasoning injection)
 *
 * Finds the nearest SOLVED similar task and renders its plan + verification
 * outcome as a worked example for the planner/implementer. Retrieving and
 * adapting the closest solved case beats abstract lesson text (DS-Agent CBR
 * +36%, arXiv:2402.17453; own-trajectory workflows, AWM arXiv:2409.07429):
 * a concrete plan-that-worked carries file names, ordering, and pitfalls that
 * distilled prose loses. Read-only; every failure degrades to ''.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { bigramJaccard } from '../memory/theme-saturation';
import { resolveWorkflowDir, readWorkflowFile } from './workflow-file-utils';

const log = createLogger('workflow:case-context');

/** Minimum title similarity for a case to count as "similar". */
const MIN_SIMILARITY = 0.25;
/** Solved tasks scanned (recent first). */
const CANDIDATE_POOL = 80;
/** Cases injected. */
const MAX_CASES = 1;
/** Per-artifact excerpt budgets (chars) — bound prompt growth. */
const PLAN_EXCERPT = 2200;
const VERIFY_EXCERPT = 700;

/** A solved case rendered into the prompt. */
export interface SolvedCase {
  taskId: number;
  title: string;
  similarity: number;
  plan: string;
  verifySummary: string | null;
}

/**
 * Rank solved candidates by title similarity. Pure and unit-testable.
 *
 * @param current - Current task title+description probe. / 現タスクの照合文字列
 * @param candidates - Solved tasks. / 解決済み候補
 * @returns Candidates at/above MIN_SIMILARITY, best first. / 類似度順の候補
 */
export function rankSolvedCases<T extends { id: number; title: string }>(
  current: string,
  candidates: T[],
): Array<T & { similarity: number }> {
  return candidates
    .map((c) => ({ ...c, similarity: bigramJaccard(current, c.title) }))
    .filter((c) => c.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Render solved cases as a prompt section. Pure and unit-testable.
 *
 * @param cases - Cases with artifacts loaded. / 成果物読込済みケース
 * @param language - Output language. / 出力言語
 * @returns Markdown section, '' when no cases. / 節（無ければ空）
 */
export function renderCaseSection(cases: SolvedCase[], language: 'ja' | 'en'): string {
  if (cases.length === 0) return '';
  const items = cases
    .map((c) => {
      const head =
        language === 'ja'
          ? `## 類似の解決済みタスク #${c.taskId}: ${c.title}（類似度 ${Math.round(c.similarity * 100)}%）`
          : `## Similar solved task #${c.taskId}: ${c.title} (similarity ${Math.round(c.similarity * 100)}%)`;
      const planLabel =
        language === 'ja'
          ? '### 当時の計画（実際に完了した plan.md 抜粋）'
          : '### The plan that worked (plan.md excerpt)';
      const verifyLabel = language === 'ja' ? '### 検証結果の要点' : '### Verification outcome';
      const parts = [head, planLabel, c.plan.slice(0, PLAN_EXCERPT)];
      if (c.verifySummary) parts.push(verifyLabel, c.verifySummary.slice(0, VERIFY_EXCERPT));
      return parts.join('\n');
    })
    .join('\n\n');
  const lead =
    language === 'ja'
      ? '# 参考事例（CBR — 過去に完了した最近傍タスク）\n\n以下は本タスクに最も近い**完了済み**タスクの計画と結果です。ファイル構成・手順の順序・落とし穴の参考にしてください。ただし**コピペせず**、本タスクの要件・現在のコードに適応させること。要件が異なる箇所は事例より本タスクを優先します。'
      : '# Reference case (CBR — nearest previously SOLVED task)\n\nBelow is the plan and outcome of the most similar COMPLETED task. Use it for file layout, step ordering, and pitfalls — but ADAPT it to this task and the current code; where requirements differ, this task wins.';
  return `${lead}\n\n${items}`;
}

/**
 * Build the case-based-reasoning section for a task: nearest solved similar
 * task's plan + verify summary. Best-effort — '' on any failure, missing
 * artifacts (e.g. cleaned-up md files) simply skip that candidate.
 *
 * @param taskId - Current task. / 現タスク
 * @param task - Title/description used as the similarity probe. / 照合入力
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or ''. / 節（無ければ空）
 */
export async function buildCaseContext(
  taskId: number,
  task: { title: string; description: string | null },
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const row = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const candidates = await prisma.task.findMany({
      where: {
        id: { not: taskId },
        parentId: null,
        status: { in: ['done', 'completed'] },
        ...(row?.themeId != null ? { themeId: row.themeId } : {}),
      },
      orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
      take: CANDIDATE_POOL,
      select: { id: true, title: true },
    });
    if (candidates.length === 0) return '';

    const ranked = rankSolvedCases(task.title, candidates);
    const cases: SolvedCase[] = [];
    for (const cand of ranked) {
      if (cases.length >= MAX_CASES) break;
      const resolved = await resolveWorkflowDir(cand.id).catch(() => null);
      if (!resolved) continue;
      // Completed-task cleanup deletes md files — a case without its plan
      // carries nothing concrete to adapt, so skip it.
      const plan = await readWorkflowFile(resolved.dir, 'plan').catch(() => null);
      if (!plan?.trim()) continue;
      const verify = await readWorkflowFile(resolved.dir, 'verify').catch(() => null);
      cases.push({
        taskId: cand.id,
        title: cand.title,
        similarity: cand.similarity,
        plan,
        verifySummary: verify?.trim() ? verify : null,
      });
    }
    const section = renderCaseSection(cases, language);
    if (section) {
      log.info(
        { taskId, cases: cases.map((c) => ({ id: c.taskId, sim: c.similarity })) },
        '[case-context] Injecting solved-case reference (CBR)',
      );
    }
    return section;
  } catch (err) {
    log.warn({ err, taskId }, '[case-context] Failed to build case context — skipping');
    return '';
  }
}
