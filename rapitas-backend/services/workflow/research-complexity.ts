/**
 * research-complexity
 *
 * Extracts the 0-100 complexity score the RESEARCH agent embeds in research.md
 * after actually inspecting the repository, and applies it to the task (score +
 * workflow mode). This code-grounded score replaces the a-priori keyword
 * heuristic for model / workflow auto-selection.
 */

import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { selectModeByComplexity } from './workflow-mode-config';
import type { WorkflowMode } from './workflow-types';

const log = createLogger('research-complexity');

/**
 * Parse a 0-100 complexity score from a research report.
 *
 * Accepts the prompted format (`## 複雑度評価` / `スコア: NN`) plus common
 * variants ("複雑度: NN", "complexity: NN", "NN / 100"). Returns null when no
 * valid score is present so callers can fall back to the heuristic.
 *
 * @param markdown - research.md content. / 調査レポート本文
 * @returns Integer 0-100, or null when absent/invalid. / 0-100 または null
 */
export function parseResearchComplexity(markdown: string | null | undefined): number | null {
  if (!markdown) return null;

  const patterns: RegExp[] = [
    // "スコア: 65" / "スコア：65 / 100" (under the 複雑度評価 heading)
    /スコア[\s:：]*?(\d{1,3})\s*(?:\/\s*100)?/i,
    // "複雑度: 65" / "複雑度スコア 65" / "複雑度（0-100）: 65"
    /複雑度[^\n0-9]{0,24}?(\d{1,3})\s*(?:\/\s*100)?/i,
    // "complexity: 65" / "complexity score 65"
    /complexity[^\n0-9]{0,24}?(\d{1,3})\s*(?:\/\s*100)?/i,
  ];

  for (const re of patterns) {
    const m = markdown.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
    }
  }
  return null;
}

/**
 * Apply the research-grounded complexity from a research.md to a task: persist the
 * score AND re-select the workflow mode from it in BOTH directions (upgrade OR
 * downgrade), unless the user pinned the mode (workflowModeOverride).
 *
 * Research read the REAL code, so it supersedes the pre-research metadata estimate
 * (which is deliberately standard-biased). A richer standard/comprehensive
 * research.md is a SUPERSET that still feeds a downgraded lightweight
 * implementation fine, so a downgrade never strands the artifact. Shared by the
 * auto-run CLI executor AND the HTTP research-save handler so manual and auto runs
 * refine the mode identically (avoids the "標準 · 複雑度 18" mismatch where a low
 * code-grounded score was stuck in a metadata-picked 'standard').
 *
 * @param taskId - Task whose research just completed. / 調査完了タスクID
 * @param researchContent - research.md body. / research.md 本文
 * @returns The applied score + resulting mode, or null when no score was found. / 適用結果、無ければnull
 */
export async function applyResearchAssessedComplexity(
  taskId: number,
  researchContent: string,
): Promise<{ assessed: number; workflowMode: WorkflowMode | null } | null> {
  const assessed = parseResearchComplexity(researchContent);
  if (assessed === null) return null;

  const current = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { workflowModeOverride: true, workflowMode: true },
    })
    .catch(() => null);

  const data: { complexityScore: number; workflowMode?: string } = { complexityScore: assessed };
  let resultingMode: WorkflowMode | null = null;

  // Respect a manual override — never clobber a user-pinned mode.
  if (!current?.workflowModeOverride) {
    const assessedMode = await selectModeByComplexity(assessed);
    const currentMode = (current?.workflowMode as WorkflowMode) || 'comprehensive';
    if (assessedMode !== currentMode) data.workflowMode = assessedMode;
    resultingMode = assessedMode;
  }

  await prisma.task.update({ where: { id: taskId }, data }).catch((err) => {
    log.warn({ err, taskId }, '[research-complexity] failed to persist assessed complexity');
  });
  log.info(
    { taskId, complexityScore: assessed, workflowMode: data.workflowMode ?? '(unchanged)' },
    '[research-complexity] applied research-assessed complexity (both directions)',
  );
  return { assessed, workflowMode: resultingMode };
}
