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

/** One parsed decision. predictedOutcome/confidence are present only when stated. */
export interface ParsedPlanDecision {
  decision: string;
  rationale: string;
  /** Planner-stated expected outcome (NOT a copy of the rationale). / 予測結果 */
  predictedOutcome?: string;
  /** Planner-stated confidence 0.0–1.0, parsed from "確信度: N%". / 確信度 */
  confidence?: number;
}

/**
 * Extract decision bullets under a `## 意思決定` / `## Decisions` heading. The full
 * form is `- 採用: 選択 ｜ 理由: 理由 ｜ 予測: 期待結果 ｜ 確信度: 70%`; every clause
 * after the choice is optional and order-independent (split on ｜ / |).
 *
 * @param content - plan.md body / plan.md 本文
 * @returns Parsed decisions / 抽出した意思決定
 */
export function extractPlanDecisions(content: string | null | undefined): ParsedPlanDecision[] {
  if (!content) return [];
  const out: ParsedPlanDecision[] = [];
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
    // Split into ｜/|-separated clauses: first is the choice, the rest are
    // keyword: value clauses (理由 / 予測 / 確信度), order-independent.
    const parts = (m[1] ?? '').split(/\s*[｜|]\s*/);
    const decision = (parts[0] ?? '').trim();
    let rationale = '';
    let predictedOutcome: string | undefined;
    let confidence: number | undefined;
    for (const seg of parts.slice(1)) {
      const r = seg.match(/^(?:理由|reason)[:：]\s*(.+)$/i);
      if (r) {
        rationale = r[1]!.trim();
        continue;
      }
      const p = seg.match(/^(?:予測|予想|prediction|expected)[:：]\s*(.+)$/i);
      if (p) {
        predictedOutcome = p[1]!.trim();
        continue;
      }
      const c = seg.match(/^(?:確信度|信頼度|confidence)[:：]\s*(\d{1,3})\s*%?/i);
      if (c) {
        const n = Number.parseInt(c[1]!, 10);
        if (Number.isFinite(n)) confidence = Math.max(0, Math.min(1, n / 100));
      }
    }
    if (decision.length < MIN_DECISION_LEN) continue;
    out.push({
      decision,
      rationale,
      ...(predictedOutcome && { predictedOutcome }),
      ...(confidence !== undefined && { confidence }),
    });
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
        // Use the planner's STATED prediction; when absent, derive a neutral
        // expectation from the decision itself. Never copy the rationale — that
        // made the journal's 理由 and 予測される結果 fields show identical text.
        predictedOutcome:
          it.predictedOutcome || `「${it.decision}」が意図通り機能し、想定した効果が得られる`,
        // Planner-stated confidence; createDecision keeps its 0.5 default only when
        // the planner omitted 確信度 (the prompt now asks for it explicitly).
        ...(it.confidence !== undefined && { confidence: it.confidence }),
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
