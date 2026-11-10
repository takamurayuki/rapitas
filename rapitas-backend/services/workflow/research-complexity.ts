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
import { getModeSettings, selectModeByComplexity } from './workflow-mode-config';
import type { WorkflowMode } from './workflow-types';
import { resolveComplexityScore } from './complexity-score';

const log = createLogger('research-complexity');

/**
 * Parse a 0-100 complexity score from a research report.
 *
 * Reads ONLY the `## 複雑度評価` section (also `複雑度`/`complexity` headings),
 * the same way research-risk.ts reads only `## リスク判定`. Inside it accepts
 * `スコア: NN`, `複雑度: NN`, `complexity: NN` and `NN / 100`. Returns null when
 * the section or a valid score is absent; callers resolve null through
 * resolveComplexityScore (complexity-score.ts).
 *
 * NOTE: This used to match the FIRST `スコア` anywhere in the report, so a body
 * line like 「既存の信頼度スコア 0.8」 turned an assessed 78 into 0 (→ lightweight
 * mode, economy tier). rapitas has many score features, so research reports
 * quote such lines routinely (routing-eval §1.2).
 *
 * @param markdown - research.md content. / 調査レポート本文
 * @returns Integer 0-100, or null when absent/invalid. / 0-100 または null
 */
export function parseResearchComplexity(markdown: string | null | undefined): number | null {
  if (!markdown) return null;

  // NOTE: no `m` flag, for the same reason as research-risk.ts — with it `$`
  // is end-of-LINE and the lazy body stops on the heading line itself.
  const section = markdown.match(
    /(?:^|\n)#{1,4}\s*(?:複雑度評価|複雑度|complexity(?:\s+assessment)?)[^\n]*\n([\s\S]{0,600}?)(?=\n#{1,4}\s|$)/i,
  );
  if (!section) return null;
  const body = section[1];

  const patterns: RegExp[] = [
    // "スコア: 65" / "スコア：65 / 100"
    /スコア[\s:：]*?(\d{1,3})\s*(?:\/\s*100)?/i,
    // "複雑度: 65" / "複雑度スコア 65" / "複雑度（0-100）: 65"
    /複雑度[^\n0-9]{0,24}?(\d{1,3})\s*(?:\/\s*100)?/i,
    // "complexity: 65" / "complexity score 65"
    /complexity[^\n0-9]{0,24}?(\d{1,3})\s*(?:\/\s*100)?/i,
  ];

  for (const re of patterns) {
    const m = body.match(re);
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
 * A report with no readable score selects the mode for the shared default
 * (resolveComplexityScore → 50), the same value SmartRouter uses for a null
 * score, and persists NO complexityScore — the task stays "unassessed" for
 * learning statistics and SmartRouter resolves its null to the same 50.
 *
 * @param taskId - Task whose research just completed. / 調査完了タスクID
 * @param researchContent - research.md body. / research.md 本文
 * @returns The parsed score (null when absent), the score actually applied, and the resulting mode / 解析値・適用値・モード
 */
export async function applyResearchAssessedComplexity(
  taskId: number,
  researchContent: string,
): Promise<{ assessed: number | null; appliedScore: number; workflowMode: WorkflowMode | null }> {
  const assessed = parseResearchComplexity(researchContent);
  const resolved = resolveComplexityScore(assessed);

  const current = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { workflowModeOverride: true, workflowMode: true, themeId: true },
    })
    .catch(() => null);

  const data: { complexityScore?: number; workflowMode?: string } = {};
  if (resolved.assessed) data.complexityScore = resolved.score;
  let resultingMode: WorkflowMode | null = null;

  // Respect a manual override — never clobber a user-pinned mode.
  if (!current?.workflowModeOverride) {
    const assessedMode = await selectModeByComplexity(resolved.score);
    const currentMode = (current?.workflowMode as WorkflowMode) || 'comprehensive';
    if (assessedMode !== currentMode) data.workflowMode = assessedMode;
    resultingMode = assessedMode;
  }

  if (Object.keys(data).length > 0) {
    await prisma.task.update({ where: { id: taskId }, data }).catch((err) => {
      log.warn({ err, taskId }, '[research-complexity] failed to persist assessed complexity');
    });
  }
  log.info(
    {
      taskId,
      complexityScore: assessed,
      appliedScore: resolved.score,
      workflowMode: data.workflowMode ?? '(unchanged)',
    },
    resolved.assessed
      ? '[research-complexity] applied research-assessed complexity (both directions)'
      : '[research-complexity] no readable score in research.md — applied the default',
  );

  // Snapshot the prediction HERE — this is the only moment the score, the mode
  // it selected and the duration history that informed it all coexist. Recording
  // it later would reconstruct a prediction rather than preserve one. A default
  // is not a prediction, so nothing is recorded for it.
  if (resolved.assessed) {
    await snapshotPrediction(taskId, resolved.score, {
      effectiveMode: resultingMode ?? ((current?.workflowMode as WorkflowMode) || 'comprehensive'),
      wasOverridden: Boolean(current?.workflowModeOverride),
      themeId: current?.themeId ?? null,
    });
  }

  return { assessed, appliedScore: resolved.score, workflowMode: resultingMode };
}

/**
 * Build and persist the prediction snapshot for a just-assessed task.
 *
 * Kept separate so a failure in the estimate (a history query) can never reach
 * the complexity write that is this module's actual job.
 */
async function snapshotPrediction(
  taskId: number,
  assessed: number,
  ctx: { effectiveMode: WorkflowMode; wasOverridden: boolean; themeId: number | null },
): Promise<void> {
  try {
    const [{ recordModePrediction }, { estimateDurationFromHistory }, settings] = await Promise.all(
      [
        import('./learning/mode-prediction'),
        import('./learning/workflow-learning-estimator'),
        getModeSettings(ctx.effectiveMode),
      ],
    );
    const estimated = await estimateDurationFromHistory(
      ctx.themeId,
      ctx.effectiveMode,
      assessed,
    ).catch(() => null);
    await recordModePrediction(taskId, {
      predictedComplexity: assessed,
      workflowMode: ctx.effectiveMode,
      estimatedDurationMinutes: typeof estimated === 'number' ? estimated : null,
      thresholds: { min: settings.complexityMin, max: settings.complexityMax },
      wasOverridden: ctx.wasOverridden,
    });
  } catch (err) {
    log.warn({ err, taskId }, '[research-complexity] prediction snapshot skipped (non-fatal)');
  }
}
