/**
 * mode-escalation
 *
 * Promotes a lightweight task to standard after research when research shows
 * the task is not settled, so a planner resolves what research left open
 * before anyone implements it. Complexity measures size; this measures
 * uncertainty, which is what the plan phase exists for. Not responsible for
 * the complexity-based choice itself (workflow-mode-config.ts) or for
 * applying the mode (research-complexity.ts).
 *
 * NOTE: Measured 2026-11-20 over 45 days: lightweight tasks bounced 1.5–1.8
 * times each at verify, standard 36–50 only 1.1. Task 1508 (complexity 18)
 * listed 「未確定事項（プランナーが解決すべき項目）」 and failed the research
 * critic once, yet ran with no planner.
 */
import { createLogger } from '../../config/logger';
import type { WorkflowMode } from './workflow-types';

const log = createLogger('workflow:mode-escalation');

/** What research left unsettled. */
export interface EscalationSignals {
  /** The research critic rejected a research.md of this task at least once. */
  criticFailed: boolean;
  /** Items under the 未確定事項 heading of research.md. */
  openItems: number;
  /** Intake rewrote the acceptance criteria, so the spec was not complete as written. */
  criteriaAutoFixed: boolean;
}

/** The open-items heading the researcher prompt asks for. */
const OPEN_ITEMS_HEADING = /^##\s*未確定事項/;
/** A line that says there is nothing open. */
const NOTHING_OPEN = /^(?:[-*]\s*)?(?:なし|特になし|無し|none|n\/a)\s*[。.]?$/i;

/**
 * Count the items listed under research.md's 未確定事項 heading.
 *
 * Bullets and table body rows count; a "なし" line, the table header and its
 * separator do not.
 *
 * @param markdown - research.md body / 調査レポート本文
 * @returns Number of open items / 未確定事項の件数
 */
export function countOpenItems(markdown: string | null | undefined): number {
  return listOpenItems(markdown).length;
}

/**
 * The items listed under research.md's 未確定事項 heading, as plain text.
 *
 * @param markdown - research.md body / 調査レポート本文
 * @returns Item texts, checkbox and bullet markers removed / 未確定事項の本文
 */
export function listOpenItems(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => OPEN_ITEMS_HEADING.test(l.trim()));
  if (start < 0) return [];
  const items: string[] = [];
  let tableRow = 0;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^#{1,2}\s/.test(line)) break;
    if (!line || NOTHING_OPEN.test(line)) continue;
    if (/^[-*]\s+\S/.test(line) || /^\d+\.\s+\S/.test(line)) {
      items.push(line.replace(/^(?:[-*]|\d+\.)\s+(?:\[[ xX]\]\s*)?/, ''));
    } else if (line.startsWith('|')) {
      tableRow += 1;
      // Row 1 is the header and row 2 the separator.
      if (tableRow > 2 && !/^\|[\s:|-]+\|$/.test(line)) {
        items.push(
          line
            .replace(/^\||\|$/g, '')
            .split('|')[0]
            .trim(),
        );
      }
    }
  }
  return items;
}

/**
 * Decide whether a lightweight task should gain the plan phase. Pure.
 *
 * @param mode - Mode chosen from complexity / 複雑度で決まったモード
 * @param signals - What research left unsettled / 調査で残った不確かさ
 * @param standardEnabled - Whether standard mode is enabled / standard が有効か
 * @returns The mode to use and the reasons it changed / 採用するモードと理由
 */
export function decideEscalation(
  mode: WorkflowMode,
  signals: EscalationSignals,
  standardEnabled: boolean,
): { mode: WorkflowMode; reasons: string[] } {
  if (mode !== 'lightweight' || !standardEnabled) return { mode, reasons: [] };
  const reasons: string[] = [];
  if (signals.criticFailed) reasons.push('research_critic_failed');
  if (signals.openItems > 0) reasons.push(`open_items:${signals.openItems}`);
  if (signals.criteriaAutoFixed) reasons.push('criteria_auto_fixed');
  return { mode: reasons.length > 0 ? 'standard' : mode, reasons };
}

/**
 * Read the signals for a task from its transitions and research.md.
 * Fails toward no signal: a lookup error keeps the complexity-based mode.
 *
 * @param taskId - Task whose research just completed / 調査完了タスクID
 * @param researchContent - research.md body / 調査レポート本文
 * @returns The signals / 不確かさの信号
 */
export async function readEscalationSignals(
  taskId: number,
  researchContent: string,
): Promise<EscalationSignals> {
  const openItems = countOpenItems(researchContent);
  try {
    const { prisma } = await import('../../config/database');
    const causes = await prisma.workflowTransition.findMany({
      where: { taskId, cause: { in: ['research_critic_failed', 'criteria_auto_fixed'] } },
      select: { cause: true },
    });
    return {
      criticFailed: causes.some((c) => c.cause === 'research_critic_failed'),
      openItems,
      criteriaAutoFixed: causes.some((c) => c.cause === 'criteria_auto_fixed'),
    };
  } catch (err) {
    log.warn({ err, taskId }, '[mode-escalation] transition lookup failed — open items only');
    return { criticFailed: false, openItems, criteriaAutoFixed: false };
  }
}
