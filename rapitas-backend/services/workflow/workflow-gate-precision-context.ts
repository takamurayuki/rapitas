/**
 * Workflow Gate-Precision Context
 *
 * Recalls verify_repair disputes in the same theme that did NOT resolve
 * through implementation alone — they needed a human/plan-level intervention,
 * or never resolved — and renders them as a caution section for the planner
 * and verifier. Closes the calibration half of the learning loop:
 * gate-precision-ledger.ts records the verdicts, but they were never fed
 * back into future plan/review judgment.
 *
 * Best-effort: any failure yields '' so context building never breaks.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:gate-precision-context');

/** Max disputes injected — bounds prompt growth. */
const MAX_DISPUTES = 3;
/** How many recent recorded disputes to scan before de-duplicating. */
const SCAN_LIMIT = 20;
/** Only these verdicts mean "implementation alone did not resolve it". */
const CAUTION_VERDICTS = new Set(['resolved_by_human', 'unresolved_blocked']);

/** A single prior gate-precision dispute. */
export interface GatePrecisionDispute {
  taskTitle: string;
  criterionIndex: number | null;
  reason: string;
  unresolved: boolean;
}

const TEXT = {
  ja: {
    header: '# このテーマでの過去のゲート紛糾（実装のやり直しだけでは解決しなかった事例）',
    lead: '同じテーマの以下のタスクでは、同じ受入基準への検証差し戻しが繰り返され、実装の反復だけでは解決せず、人間/計画レベルの介入で解決したか、いまだ未解決です。受入基準の曖昧さやスコープの取り違えがないか確認し、同じパターンで差し戻しを繰り返す前に一度立ち止まってください。',
    unresolvedTag: '（未解決）',
  },
  en: {
    header: '# Past Gate Disputes In This Theme (not resolved by re-implementation alone)',
    lead: 'In this theme, the following tasks had repeated verify bounces against the same acceptance criterion that did not resolve through implementation retries alone — they needed a human/plan-level intervention, or are still unresolved. Check for ambiguous acceptance criteria or scope mismatches before repeating the same bounce pattern.',
    unresolvedTag: '(unresolved)',
  },
} as const;

/**
 * Render disputes as a markdown prompt section. Pure — testable core.
 *
 * @param items - Prior disputes (already de-duplicated, newest first). / 紛糾履歴
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or '' when there is nothing to inject. / 注入する節
 */
export function renderGatePrecisionDisputes(
  items: GatePrecisionDispute[],
  language: 'ja' | 'en',
): string {
  if (items.length === 0) return '';
  const t = TEXT[language];
  const lines = items.map((it) => {
    const crit = it.criterionIndex != null ? `#${it.criterionIndex}` : '#?';
    const tag = it.unresolved ? ` ${t.unresolvedTag}` : '';
    return `- 「${it.taskTitle}」受入基準${crit}: ${it.reason}${tag}`;
  });
  return `${t.header}\n\n${t.lead}\n\n${lines.join('\n')}`;
}

/**
 * Build the gate-precision context section for a task's theme. Shared by the
 * planner (write clearer criteria) and the verifier (hesitate before
 * re-bouncing on a historically-disputed pattern).
 *
 * @param taskId - Task being planned/verified (used to resolve its theme). / 対象タスクID
 * @param language - Output language. / 出力言語
 * @returns Markdown section, or '' when nothing relevant exists. / 紛糾履歴の節
 */
export async function buildGatePrecisionContext(
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

    const rows = await prisma.gatePrecisionCase.findMany({
      where: { taskId: { in: themeTasks.map((t) => t.id) } },
      orderBy: { detectedAt: 'desc' },
      take: SCAN_LIMIT,
      select: { taskId: true, criterionIndex: true, reason: true, verdict: true },
    });

    const items: GatePrecisionDispute[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      if (!CAUTION_VERDICTS.has(r.verdict) || !r.reason) continue;
      const key = `${r.taskId}:${r.criterionIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        taskTitle: idToTitle.get(r.taskId) ?? `#${r.taskId}`,
        criterionIndex: r.criterionIndex,
        reason: r.reason,
        unresolved: r.verdict === 'unresolved_blocked',
      });
      if (items.length >= MAX_DISPUTES) break;
    }

    const section = renderGatePrecisionDisputes(items, language);
    if (section) {
      log.info(
        { taskId, themeId: self.themeId, count: items.length },
        '[gate-precision-context] Injected',
      );
    }
    return section;
  } catch (err) {
    log.warn({ err, taskId }, '[gate-precision-context] Skipped (unavailable)');
    return '';
  }
}
