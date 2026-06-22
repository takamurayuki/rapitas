/**
 * decision-from-plan
 *
 * Reliable DECISION creation: parse a structured `## 意思決定` / `## Decisions`
 * section out of a saved plan.md and record each line in the decision journal.
 * The planner is where deliberate design choices are made (adopt option A, reject
 * B, accept a trade-off), so plan.md is the natural source — the journal stayed
 * empty because nothing auto-filed it (the same dormancy the hypothesis ledger
 * had). Distinct from hypotheses: a decision is a SETTLED choice + rationale
 * (recorded, not tested), whereas a hypothesis is a falsifiable belief (validated
 * by evidence). Not responsible for calibration/review of decisions.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createDecision } from './decision-journal-service';

const log = createLogger('memory:decision-from-plan');

/** Most decisions to file from a single plan.md, to avoid journal noise. */
const MAX_PER_PLAN = 6;
/** Skip stub lines shorter than this. */
const MIN_DECISION_LEN = 8;

/**
 * Extract `- 採用: 選択 ｜ 理由: 理由` bullets under a `## 意思決定` / `## Decisions`
 * heading. The `採用:` prefix and the `｜ 理由:` clause are optional.
 *
 * @param content - plan.md body / plan.md 本文
 * @returns Parsed decisions (decision + rationale) / 抽出した意思決定
 */
export function extractPlanDecisions(
  content: string | null | undefined,
): { decision: string; rationale: string }[] {
  if (!content) return [];
  const out: { decision: string; rationale: string }[] = [];
  let inSection = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (/^#{1,6}\s*(意思決定|decisions?)/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line)) break; // next heading closes it
    if (!inSection) continue;
    const m = line.match(/^[-*]\s*(?:採用[:：]\s*)?(.+)$/);
    if (!m) continue;
    let decision = (m[1] ?? '').trim();
    let rationale = '';
    // Optional "｜ 理由: …" / "| Reason: …" clause splits decision from rationale.
    const sep = decision.match(/^(.+?)\s*[｜|]\s*(?:理由|reason)[:：]\s*(.+)$/i);
    if (sep) {
      decision = sep[1]!.trim();
      rationale = sep[2]!.trim();
    }
    if (decision.length < MIN_DECISION_LEN) continue;
    out.push({ decision, rationale });
    if (out.length >= MAX_PER_PLAN) break;
  }
  return out;
}

/**
 * Record every decision parsed from a plan.md in the decision journal. Best-effort
 * (never throws). Dedupes against existing decisions for the theme so re-saving
 * plan.md does not create duplicates (the journal has no native dedup).
 *
 * @param taskId - Task whose plan produced these / 計画元タスク
 * @param content - plan.md body / plan.md 本文
 * @returns Count of newly-recorded decisions / 新規記録数
 */
export async function fileDecisionsFromPlan(
  taskId: number,
  content: string | null | undefined,
): Promise<number> {
  const items = extractPlanDecisions(content);
  if (items.length === 0) return 0;
  const task = await prisma.task
    .findUnique({ where: { id: taskId }, select: { themeId: true } })
    .catch(() => null);
  const themeId = task?.themeId ?? undefined;

  const existing = await prisma.decisionLog
    .findMany({
      where: { ...(themeId != null && { themeId }) },
      select: { decision: true },
      take: 200,
      orderBy: { createdAt: 'desc' },
    })
    .catch(() => [] as { decision: string }[]);
  const seen = new Set(existing.map((e) => e.decision));

  let filed = 0;
  for (const it of items) {
    if (seen.has(it.decision)) continue;
    try {
      await createDecision({
        decision: it.decision,
        context: `タスク#${taskId} の plan.md で決定`,
        rationale: it.rationale || undefined,
        // A design decision's expected effect IS its rationale; fall back to the
        // decision text so the required field is always meaningful.
        predictedOutcome: it.rationale || it.decision,
        ...(themeId != null && { themeId }),
      });
      seen.add(it.decision);
      filed += 1;
    } catch (err) {
      log.warn({ err, taskId }, '[decision-from-plan] create failed');
    }
  }
  if (filed > 0) log.info({ taskId, filed }, '[decision-from-plan] filed decisions');
  return filed;
}
