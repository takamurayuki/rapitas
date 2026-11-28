/**
 * daily-report-critic
 *
 * Counts how often the plan critic's verdict was cut off by input truncation and
 * how often its findings were returned to the planner, and renders that report
 * section. Pure — the rows are fetched by daily-report-service.
 */

/** Transition causes the section is computed from. */
export const PLAN_CRITIC_CAUSES = [
  'plan_critic_incomplete',
  'plan_critic_failed',
  'plan_critic_exhausted',
];

/** Markdown heading of the section (also used to detect a dropped section). */
export const PLAN_CRITIC_HEADING = '## 計画の点検（入力の切り詰め）';

/** WorkflowTransition row; `metadata` is the raw JSON string column. */
export interface RawCriticTransition {
  cause: string;
  metadata: string | null;
}

/** Counts for the report window. */
export interface PlanCriticSummary {
  /** False when the lookup failed, so zeros are not mistaken for "nothing happened". */
  available: boolean;
  /** Plan passes downgraded to unknown because the input was truncated. */
  truncatedDowngrades: number;
  /** Of those, the ones that carried at least one finding. */
  downgradedWithReasons: number;
  /** Plans returned to the planner from such a downgrade. */
  returned: number;
  /** Findings carried by those returns. */
  returnedReasons: number;
  /** Downgrades with findings that proceeded because the bounce budget was used. */
  proceededExhausted: number;
}

function parseMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Aggregate the window's plan-critic transitions. Rows with unreadable metadata
 * are skipped.
 *
 * @param rows - Fetched rows; null when the lookup failed, undefined for none. / 取得行
 * @returns Counts for the report. / 集計値
 */
export function summarizePlanCritic(
  rows: RawCriticTransition[] | null | undefined,
): PlanCriticSummary {
  const summary: PlanCriticSummary = {
    available: rows !== null,
    truncatedDowngrades: 0,
    downgradedWithReasons: 0,
    returned: 0,
    returnedReasons: 0,
    proceededExhausted: 0,
  };
  for (const row of rows ?? []) {
    const meta = parseMetadata(row.metadata);
    if (!meta) continue;
    const reasonCount = Array.isArray(meta.reasons) ? meta.reasons.length : 0;
    if (row.cause === 'plan_critic_incomplete' && meta.downgradedByTruncation === true) {
      summary.truncatedDowngrades++;
      if (reasonCount > 0) summary.downgradedWithReasons++;
    } else if (row.cause === 'plan_critic_failed' && meta.returnedFromTruncation === true) {
      summary.returned++;
      summary.returnedReasons += reasonCount;
    } else if (row.cause === 'plan_critic_exhausted' && meta.returnedFromTruncation === true) {
      summary.proceededExhausted++;
    }
  }
  return summary;
}

/**
 * Render the section as markdown lines, heading included.
 *
 * @param summary - Aggregated counts. / 集計値
 * @returns Markdown lines. / Markdownの行
 */
export function formatPlanCriticSection(summary: PlanCriticSummary): string[] {
  const body = summary.available
    ? [
        `- 切り詰めで判定不能: ${summary.truncatedDowngrades}件（うち指摘あり ${summary.downgradedWithReasons}件）`,
        `- 指摘を計画の担当へ返した: ${summary.returned}件（指摘 ${summary.returnedReasons}件）`,
        `- 差し戻し枠を使い切り進めた: ${summary.proceededExhausted}件`,
      ]
    : ['- 取得できませんでした'];
  return [PLAN_CRITIC_HEADING, '', ...body];
}

/**
 * Remove every copy of the section: from its heading up to the next `#` or `##`
 * heading. Used so the counts are never taken from AI-rewritten text.
 *
 * @param markdown - Report markdown. / レポート本文
 * @returns The markdown without the section, trailing blank lines trimmed. / 節を除いた本文
 */
export function stripPlanCriticSection(markdown: string): string {
  let inSection = false;
  return markdown
    .split('\n')
    .filter((line) => {
      if (line.startsWith(PLAN_CRITIC_HEADING)) inSection = true;
      else if (/^#{1,2}\s/.test(line)) inSection = false;
      return !inSection;
    })
    .join('\n')
    .trimEnd();
}
