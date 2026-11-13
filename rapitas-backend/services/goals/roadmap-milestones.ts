/**
 * roadmap-milestones
 *
 * Reads the milestones (節目) ラピ drafts between a goal and its steps, and
 * which milestone each step builds towards. Pure — the draft calls it, the
 * commit creates the rows. Not responsible for the steps themselves
 * (services/assistant/roadmap-resolve.ts).
 */
import { normalizeCriteria } from '../assistant/criteria-text';
import { MAX_ROADMAP_MILESTONES, MAX_ROADMAP_STEPS } from '../assistant/roadmap-prompts';
import { asDayCount, asText, dayAfter, MAX_TITLE } from '../assistant/roadmap-resolve';

export { MAX_ROADMAP_MILESTONES };

/** A drafted milestone, ready to be shown and, once approved, created. */
export interface RoadmapMilestone {
  name: string;
  /** What must be true to call it reached — becomes Milestone.acceptanceCriteria. */
  acceptanceCriteria: string[];
  /** Target date, only when the request named a deadline (YYYY-MM-DD). */
  dueDate?: string;
}

/**
 * Keep the milestones that could actually become one.
 *
 * @param raw - Whatever the model put in `milestones` / モデルの出力
 * @param dates - Today, and the deadline in days when one was named / 起点日と期限
 * @returns Named milestones with cleaned criteria / 節目の一覧
 */
export function resolveRoadmapMilestones(
  raw: unknown,
  dates: { today: Date; deadlineInDays?: number },
): RoadmapMilestone[] {
  if (!Array.isArray(raw)) return [];
  const out: RoadmapMilestone[] = [];
  for (const item of raw) {
    const m = (item ?? {}) as { name?: unknown; done?: unknown; dueInDays?: unknown };
    const name = asText(m.name, MAX_TITLE);
    if (!name) continue;
    const due = asDayCount(m.dueInDays);
    // Same rule as steps: a date only means something against a named
    // deadline, and a milestone due after the deadline is the wrong date.
    const dueDate =
      due !== undefined && dates.deadlineInDays !== undefined
        ? dayAfter(dates.today, Math.min(due, dates.deadlineInDays))
        : undefined;
    out.push({
      name,
      acceptanceCriteria: normalizeCriteria(m.done),
      ...(dueDate ? { dueDate } : {}),
    });
    if (out.length >= MAX_ROADMAP_MILESTONES) break;
  }
  return out;
}

/**
 * Which milestone each resolved step builds towards.
 *
 * Walks the raw steps with the same filter `resolveSteps` applies (a step
 * needs a title; at most MAX_ROADMAP_STEPS), so index i of the result lines
 * up with step i of the draft.
 *
 * @param rawSteps - Whatever the model put in `steps` / モデルの出力
 * @param milestoneCount - How many milestones were kept / 残った節目の数
 * @returns A milestone index per kept step, or undefined / ステップごとの節目番号
 */
export function stepMilestoneIndexes(
  rawSteps: unknown,
  milestoneCount: number,
): Array<number | undefined> {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps
    .filter((s) => asText((s ?? {}).title, MAX_TITLE))
    .slice(0, MAX_ROADMAP_STEPS)
    .map((s) => {
      const index = (s as { milestone?: unknown }).milestone;
      return typeof index === 'number' &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < milestoneCount
        ? index
        : undefined;
    });
}
