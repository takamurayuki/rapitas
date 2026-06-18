/**
 * Workflow Rejected-Plan Context
 *
 * Recalls why recent plans in the same theme were REJECTED by a human and renders
 * them as a planner prompt section, so a new plan does not repeat a design the
 * user already turned down. Closes the human-feedback half of the learning loop:
 * rejections were recorded (`WorkflowTransition` cause='manual_plan_rejected')
 * but never fed back into planning.
 *
 * Best-effort: any failure yields '' so context building never breaks.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:rejected-plan-context');

/** Max rejection reasons injected — bounds prompt growth. */
const MAX_REASONS = 3;
/** How many recent rejection rows to scan before de-duplicating. */
const SCAN_LIMIT = 20;

/** A single prior plan rejection. */
export interface RejectedPlan {
  taskTitle: string;
  reason: string;
}

const TEXT = {
  ja: {
    header: '# 過去に却下された計画（人間のフィードバック — 繰り返さないこと）',
    lead: '同じテーマで、以下の計画が人間により却下されています。今回の計画では同じ指摘を繰り返さないよう、却下理由を満たす設計にしてください。',
  },
  en: {
    header: '# Previously Rejected Plans (human feedback — do not repeat)',
    lead: 'In this theme, the following plans were rejected by a human. Make sure your plan addresses these reasons instead of repeating them.',
  },
} as const;

/**
 * Render rejection reasons as a markdown prompt section. Pure — testable core.
 *
 * @param items - Prior rejections (already de-duplicated, newest first). / 却下履歴
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or '' when there is nothing to inject. / 注入する節
 */
export function renderRejectedPlans(items: RejectedPlan[], language: 'ja' | 'en'): string {
  if (items.length === 0) return '';
  const t = TEXT[language];
  const lines = items.map((it) => `- 「${it.taskTitle}」: ${it.reason}`);
  return `${t.header}\n\n${t.lead}\n\n${lines.join('\n')}`;
}

/** Safely extract a `reason` string from a WorkflowTransition.metadata JSON string. */
function parseReason(metadata: string | null): string {
  if (!metadata) return '';
  try {
    const m = JSON.parse(metadata) as { reason?: unknown };
    return typeof m.reason === 'string' ? m.reason.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Build the rejected-plan context section for a task's theme.
 *
 * @param taskId - Task being planned (used to resolve its theme). / 計画中タスクID
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or '' when nothing relevant exists. / 却下履歴の節
 */
export async function buildRejectedPlanContext(
  taskId: number,
  language: 'ja' | 'en' = 'ja',
): Promise<string> {
  try {
    const self = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    if (self?.themeId == null) return '';

    const themeTasks = await prisma.task.findMany({
      where: { themeId: self.themeId },
      select: { id: true, title: true },
    });
    if (themeTasks.length === 0) return '';
    const idToTitle = new Map(themeTasks.map((t) => [t.id, t.title]));

    const rows = await prisma.workflowTransition.findMany({
      where: { taskId: { in: themeTasks.map((t) => t.id) }, cause: 'manual_plan_rejected' },
      orderBy: { createdAt: 'desc' },
      take: SCAN_LIMIT,
      select: { taskId: true, metadata: true },
    });

    const items: RejectedPlan[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const reason = parseReason(r.metadata);
      if (!reason) continue;
      const key = `${r.taskId}:${reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ taskTitle: idToTitle.get(r.taskId) ?? `#${r.taskId}`, reason });
      if (items.length >= MAX_REASONS) break;
    }

    const section = renderRejectedPlans(items, language);
    if (section) {
      log.info({ taskId, themeId: self.themeId, count: items.length }, '[rejected-plan] Injected');
    }
    return section;
  } catch (err) {
    log.warn({ err, taskId }, '[rejected-plan] Skipped (unavailable)');
    return '';
  }
}
