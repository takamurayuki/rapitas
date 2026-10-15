/**
 * hypothesis-from-verify
 *
 * Closes the hypothesis loop with REAL verification: parse a `## 仮説評価`
 * (Hypothesis Evaluation) section out of a saved verify.md, where the verifier
 * explicitly judged whether each open hypothesis's PREDICTION held, and graduate
 * (成立 → validated) or refute (不成立 → rejected) it decisively. This replaces
 * the weak "the task completed → +0.25" signal (which never crossed the 0.8
 * graduation bar from a single completion-evidence, leaving the ledger permanently
 * 検証待ち) with an explicit, falsifiable verdict. Not responsible for forming
 * hypotheses (see hypothesis-from-research) or injecting them (see
 * workflow-hypothesis-context).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { addEvidence, listHypotheses } from './hypothesis-service';
import { bigramSimilarity } from './text-similarity';

const log = createLogger('memory:hypothesis-from-verify');

/** Parsed verdict for one hypothesis from a verify.md `## 仮説評価` section. */
export interface HypothesisVerdict {
  /**
   * Ledger id from a `[#id]` anchor, or null when the verifier restated the
   * hypothesis by `[domain] statement` instead (the common drift — it mirrors the
   * research.md `## 仮説` format). A null id is resolved against the task's open
   * hypotheses by statement match in applyHypothesisVerdictsFromVerify.
   */
  hypothesisId: number | null;
  verdict: 'confirmed' | 'refuted';
  /** The verifier's full verdict line (reason + statement, for matching/detail). / 判定行 */
  reason: string;
}

// 成立 / confirmed / 立証 / ✓ → the prediction held. 不成立 / refuted / 反証 / ✗ →
// it did not. Anything else (保留 / 不明 / inconclusive) is intentionally ignored
// so an uncertain verifier leaves the hypothesis open rather than forcing a verdict.
const CONFIRM_RE = /(成立|確認|立証|confirmed|holds?|true|✓|✔)/i;
const REFUTE_RE = /(不成立|反証|否定|refuted|false|✗|✘|×)/i;
/**
 * Min bigram-Jaccard similarity to accept an id-less verdict ↔ hypothesis match,
 * and the margin the best match must beat the runner-up by (so an ambiguous
 * verdict is left unresolved rather than mis-graduated). Bigram overlap (not LCS)
 * is used because the verifier PARAPHRASES the hypothesis — drops backticks,
 * reorders, inserts particles — which fragments any common substring but leaves
 * most character bigrams (narrow/this/分割代入/クラッシュ/…) shared.
 */
const MIN_MATCH_SIM = 0.18;
const MATCH_MARGIN = 1.25;

/**
 * Extract per-hypothesis verdicts from a verify.md `## 仮説評価` section.
 * Lines look like `- [#2854] 成立: …` (id-anchored) or, when the verifier restated
 * the hypothesis, `- [architecture] makeStringTypeGuard を…: **成立** — …` (id-less,
 * resolved later by statement match). Lines with no 成立/不成立 verdict are skipped.
 *
 * @param content - verify.md body / verify.md 本文
 * @returns Parsed verdicts (confirmed/refuted only) / 抽出した判定
 */
export function extractHypothesisVerdicts(content: string | null | undefined): HypothesisVerdict[] {
  if (!content) return [];
  const out: HypothesisVerdict[] = [];
  const seenIds = new Set<number>();
  let inSection = false;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    // A heading whose text starts with 仮説評価 / hypothesis eval opens the section.
    if (/^#{1,6}\s*(仮説評価|仮説の?評価|hypothesis\s*eval)/i.test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^#{1,6}\s/.test(line)) break; // next heading closes it
    if (!inSection) continue;

    // Markdown TABLE row: `| [#id] | 成立/不成立 | 根拠 |`. The verifier prompt
    // mandates "テーブル必須", so verdicts often arrive as a table rather than a
    // bullet list — without this branch those graduations were silently dropped
    // (observed: every table-format 仮説評価 left its hypotheses permanently open).
    if (line.startsWith('|')) {
      const cells = line
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      // Skip header (`| 仮説 ID | 判定 |`) and separator (`| --- | --- |`) rows.
      if (cells.length < 2 || cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const idCell = cells.find((c) => /#\d+/.test(c));
      const idMatch = idCell?.match(/#(\d+)/);
      // The verdict lives in the short 判定 cell, not the long 根拠 cell — bound the
      // length so evidence prose mentioning "否定"/"×" cannot flip the verdict.
      const verdictCell = cells.find(
        (c) =>
          c.replace(/[`*✅⚠️\s]/g, '').length <= 8 && (REFUTE_RE.test(c) || CONFIRM_RE.test(c)),
      );
      if (!verdictCell) continue;
      const tVerdict: 'confirmed' | 'refuted' = REFUTE_RE.test(verdictCell)
        ? 'refuted'
        : 'confirmed';
      const tId = idMatch ? Number(idMatch[1]) : null;
      if (tId != null) {
        if (!Number.isFinite(tId) || seenIds.has(tId)) continue;
        seenIds.add(tId);
      }
      out.push({ hypothesisId: tId, verdict: tVerdict, reason: cells.join(' ').slice(0, 300) });
      continue;
    }

    // Any bullet line; the `#id` anchor is OPTIONAL (captured when present).
    const m = line.match(/^[-*]\s*(?:\[?#(\d+)\]?\s*)?(.+)$/);
    if (!m) continue;
    const rest = (m[2] ?? '').trim();
    // Refutation takes precedence so a line mentioning both ("成立しない=不成立")
    // is not mis-read as confirmed.
    let verdict: 'confirmed' | 'refuted' | null = null;
    if (REFUTE_RE.test(rest)) verdict = 'refuted';
    else if (CONFIRM_RE.test(rest)) verdict = 'confirmed';
    if (!verdict) continue;
    const hypothesisId = m[1] ? Number(m[1]) : null;
    if (hypothesisId != null) {
      if (!Number.isFinite(hypothesisId) || seenIds.has(hypothesisId)) continue;
      seenIds.add(hypothesisId);
    }
    out.push({ hypothesisId, verdict, reason: rest.slice(0, 300) });
  }
  return out;
}

// NOTE: normalizeForMatch / bigrams / bigramSimilarity moved to
// ./text-similarity.ts — the contradiction near-dup gate and write-time dedup
// need the same lexical similarity, so the trio became a shared util.

/**
 * Apply explicit hypothesis verdicts parsed from a verify.md. Each verdict is a
 * DECISIVE piece of evidence, so a confirmed hypothesis graduates to validated and
 * a refuted one is rejected in a single call. Best-effort: never throws (a parse /
 * DB hiccup must not fail the verify save).
 *
 * @param taskId - Task whose verify.md produced these verdicts / 検証元タスク
 * @param content - verify.md body / verify.md 本文
 * @returns Count of verdicts applied / 適用した判定数
 */
export async function applyHypothesisVerdictsFromVerify(
  taskId: number,
  content: string | null | undefined,
): Promise<number> {
  const verdicts = extractHypothesisVerdicts(content);
  if (verdicts.length === 0) return 0;

  // Resolve id-less verdicts (the verifier restated the hypothesis instead of
  // citing `[#id]`) against THIS task's still-open hypotheses by statement match.
  // Matching is conservative — a long common substring, each hypothesis used at
  // most once, ambiguous matches skipped — so a wrong hypothesis is never graduated.
  const needMatch = verdicts.some((v) => v.hypothesisId == null);
  if (needMatch) {
    const open = await listOpenHypothesesForTask(taskId);
    const used = new Set<number>(
      verdicts.map((v) => v.hypothesisId).filter((id): id is number => id != null),
    );
    for (const v of verdicts) {
      if (v.hypothesisId != null) continue;
      let bestId: number | null = null;
      let bestSim = 0;
      let secondSim = 0;
      for (const h of open) {
        if (used.has(h.id)) continue;
        const sim = bigramSimilarity(v.reason, h.statement);
        if (sim > bestSim) {
          secondSim = bestSim;
          bestSim = sim;
          bestId = h.id;
        } else if (sim > secondSim) {
          secondSim = sim;
        }
      }
      // Accept only a confident, unambiguous winner — clears the floor AND beats
      // the runner-up by the margin — so a wrong hypothesis is never graduated.
      if (bestId != null && bestSim >= MIN_MATCH_SIM && bestSim >= secondSim * MATCH_MARGIN) {
        v.hypothesisId = bestId;
        used.add(bestId);
      }
    }
  }

  let applied = 0;
  for (const v of verdicts) {
    if (v.hypothesisId == null) continue; // unresolved — skip rather than mis-graduate
    try {
      const res = await addEvidence(v.hypothesisId, {
        stance: v.verdict === 'confirmed' ? 'for' : 'against',
        detail:
          v.verdict === 'confirmed'
            ? `verify で予測の的中を確認: ${v.reason}`
            : `verify で予測の不成立を確認: ${v.reason}`,
        // Concrete artifact (has '#' + digits + ':') so the evidence gate accepts it.
        artifact: `task#${taskId}:verify-verdict`,
        taskId,
        phase: 'verify',
        decisive: true,
      });
      if (res.ok) applied += 1;
    } catch (err) {
      log.warn(
        { err, taskId, hypothesisId: v.hypothesisId },
        '[hypothesis-from-verify] addEvidence failed',
      );
    }
  }
  if (applied > 0) {
    log.info({ taskId, applied }, '[hypothesis-from-verify] applied explicit verdicts');
  }
  return applied;
}

/**
 * Fetch the still-open hypotheses this task formed (originTaskId === taskId), for
 * matching id-less verdicts. Best-effort: returns [] on any error.
 */
async function listOpenHypothesesForTask(
  taskId: number,
): Promise<{ id: number; statement: string }[]> {
  try {
    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { themeId: true } })
      .catch(() => null);
    const { hypotheses } = await listHypotheses({
      status: 'open',
      ...(task?.themeId != null && { themeId: task.themeId }),
      limit: 100,
    });
    return hypotheses
      .filter((h) => h.originTaskId === taskId)
      .map((h) => ({ id: h.id, statement: h.statement }));
  } catch {
    return [];
  }
}
