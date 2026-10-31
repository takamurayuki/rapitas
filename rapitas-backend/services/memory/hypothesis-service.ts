/**
 * hypothesis-service
 *
 * 仮説台帳 (Hypothesis Ledger) — an epistemic layer separate from the idea box
 * (what to build) and concern backlog (what to fix). A hypothesis is a
 * falsifiable conjecture ("X causes Y", "Z would improve metric W") that is
 * UNKNOWN until evidence is gathered. Unlike ideas/concerns it NEVER spawns a
 * task: hypotheses are tested opportunistically as a byproduct of normal agent
 * work (research / implement / verify) and graduate to validated knowledge only
 * when backed by CONCRETE evidence. This mimics the human hypothesis → verify →
 * prove cycle to deepen the agent's reasoning.
 *
 * Backed by KnowledgeEntry (sourceType 'hypothesis') so it reuses the KB's
 * forgetting/decay, recall, and dedup with no schema change. Status rides on
 * validationStatus: pending=open, validated=supported, rejected=refuted,
 * conflict=inconclusive. A graduated hypothesis is simply a validated KB entry.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sanitizeMarkdownContent } from '../../utils/common/mojibake-detector';
import { HYPOTHESIS_DOMAINS, normalizeDomain } from './hypothesis-types';
import type { HypothesisDomain, HypothesisStatus, EvidenceStance } from './hypothesis-types';
import { HYP_SELECT, parseEvidence, toStatus } from './hypothesis-row';
import type { HypothesisEntry, HypothesisEvidence } from './hypothesis-row';

// Re-exported so every existing importer keeps its path after the #1321
// split; the declarations themselves moved to the three sibling modules.
export { HYPOTHESIS_DOMAINS, normalizeDomain };
export type { HypothesisDomain, HypothesisStatus, EvidenceStance };
export type { HypothesisEntry, HypothesisEvidence };
export {
  listHypotheses,
  getHypothesis,
  setHypothesisStatus,
  deleteHypothesis,
  getHypothesisStats,
} from './hypothesis-queries';

const log = createLogger('memory:hypothesis');

/** Confidence a brand-new (untested) hypothesis starts at — deliberately low. */
const INITIAL_CONFIDENCE = 0.2;
/** Each concrete evidence nudges confidence by this fraction (Bayesian-ish). */
const EVIDENCE_STEP = 0.25;
/** At/above this confidence with concrete supporting evidence → supported. */
const GRADUATE_AT = 0.8;
/** At/below this confidence with concrete opposing evidence → refuted. */
const REFUTE_AT = 0.2;
/** A statement shorter than this is too vague to be falsifiable. */
const MIN_STATEMENT_LEN = 12;

export interface SubmitHypothesisInput {
  statement: string;
  rationale: string;
  domain?: HypothesisDomain;
  themeId?: number;
  /** Task being worked on when the hypothesis was formed. */
  originTaskId?: number;
  /** Origin label: "agent" | "user" | "reflection" | ... */
  source?: string;
}

/** Result of registering a hypothesis (rejected when not falsifiable). */
export interface SubmitHypothesisResult {
  ok: boolean;
  id?: number;
  /** Why the hypothesis was rejected, when ok is false. */
  reason?: string;
}

function contentHash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Falsifiability gate: a hypothesis must be a concrete, testable CLAIM — not a
 * vague note and not a bare question. This is the lightweight front-line check;
 * the real rigor is the evidence gate on graduation (concrete artifact required).
 *
 * @param statement - The candidate hypothesis statement. / 仮説の命題
 * @returns null when acceptable, else a human-readable rejection reason. / 却下理由
 */
export function checkFalsifiable(statement: string): string | null {
  const s = statement.trim();
  if (s.length < MIN_STATEMENT_LEN) {
    return `命題が短すぎます（${MIN_STATEMENT_LEN}文字以上の検証可能な主張にしてください）`;
  }
  // A pure question states no claim to test — it cannot be supported/refuted.
  if (s.endsWith('?') || s.endsWith('？')) {
    return '疑問文ではなく、検証可能な断定文で記述してください';
  }
  return null;
}

/**
 * Whether a piece of evidence is concrete enough to count: it must anchor to a
 * checkable artifact (file:line, a path, a test name, a measurement/number, or a
 * #PR/issue). Hand-wavy "it seems to work" assertions are rejected — this is what
 * stops an agent from "proving" a hypothesis just to close it.
 *
 * @param artifact - The evidence anchor string. / 証拠のアンカー文字列
 * @returns true when the artifact is concrete. / 具体的なら true
 */
export function isConcreteArtifact(artifact: string): boolean {
  const a = (artifact ?? '').trim();
  if (a.length < 3) return false;
  // file:line, path/, #123, a digit (measurement/count), or a test reference.
  return /[:/#]/.test(a) || /\d/.test(a) || /test/i.test(a);
}

/**
 * Registers a hypothesis into the ledger after the falsifiability gate. Dedupes
 * by statement so the same conjecture is filed only once.
 *
 * @param input - Hypothesis details. / 仮説の詳細
 * @returns ok+id on success, or ok:false+reason when not falsifiable. / 結果
 */
export async function submitHypothesis(
  input: SubmitHypothesisInput,
): Promise<SubmitHypothesisResult> {
  // Repair mojibake before storing (agent submissions over curl on Windows can
  // arrive garbled) — same guard as ideas/concerns.
  const sanStatement = sanitizeMarkdownContent(input.statement ?? '');
  const sanRationale = sanitizeMarkdownContent(input.rationale ?? '');
  const statement = sanStatement.content.trim();
  const rationale = sanRationale.content.trim();

  const reason = checkFalsifiable(statement);
  if (reason) return { ok: false, reason };

  const domain = normalizeDomain(input.domain);
  const hash = contentHash(`hypothesis:${statement}`);

  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash: hash, sourceType: 'hypothesis' },
    select: { id: true },
  });
  if (existing) {
    log.debug({ id: existing.id }, 'Duplicate hypothesis skipped');
    return { ok: true, id: existing.id };
  }

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: 'hypothesis',
      sourceId: input.source ?? 'agent',
      title: statement,
      content: rationale,
      contentHash: hash,
      category: domain,
      tags: JSON.stringify({ evidence: [] as HypothesisEvidence[] }),
      confidence: INITIAL_CONFIDENCE,
      themeId: input.themeId ?? null,
      taskId: input.originTaskId ?? null,
      forgettingStage: 'active',
      decayScore: 1.0,
      validationStatus: 'pending',
    },
    select: { id: true },
  });

  log.info({ id: entry.id, domain, source: input.source }, 'Hypothesis filed');
  return { ok: true, id: entry.id };
}

/** Outcome of recording a piece of evidence. */
export interface AddEvidenceResult {
  ok: boolean;
  reason?: string;
  confidence?: number;
  status?: HypothesisStatus;
  /** True when this evidence graduated the hypothesis (supported/refuted). */
  graduated?: boolean;
}

/**
 * Records a piece of evidence for/against a hypothesis, updates its confidence
 * (Bayesian-ish), and auto-graduates it when the confidence crosses a threshold
 * WITH concrete evidence on that side. The evidence gate (isConcreteArtifact)
 * rejects hand-wavy proof — the core defense against confirmation bias.
 *
 * @param hypothesisId - Target hypothesis id. / 対象仮説ID
 * @param ev - Evidence: stance, detail, concrete artifact, origin. / 証拠
 * @returns Updated confidence/status, or ok:false+reason when rejected. / 結果
 */
export async function addEvidence(
  hypothesisId: number,
  ev: {
    stance: EvidenceStance;
    detail: string;
    artifact: string;
    taskId?: number | null;
    phase?: string | null;
    /**
     * Explicit verification verdict (the verifier checked the prediction itself,
     * not a weak completion proxy). A decisive 'for' jumps confidence to the
     * graduation threshold and 'against' to the refutation threshold, so ONE
     * genuine verification graduates/refutes the hypothesis instead of nudging it
     * by a fraction (which never crossed 0.8 from the single completion-evidence a
     * hypothesis used to get — leaving the whole ledger stuck at 検証待ち).
     */
    decisive?: boolean;
  },
): Promise<AddEvidenceResult> {
  if (ev.stance !== 'for' && ev.stance !== 'against') {
    return { ok: false, reason: 'stance は for / against のいずれかです' };
  }
  if (!isConcreteArtifact(ev.artifact)) {
    return {
      ok: false,
      reason:
        '具体的な根拠 (artifact) が必要です: file:line / テスト名 / 計測値 / #PR など検証可能なアンカーを記載してください',
    };
  }

  const row = await prisma.knowledgeEntry.findFirst({
    where: { id: hypothesisId, sourceType: 'hypothesis' },
    select: HYP_SELECT,
  });
  if (!row) return { ok: false, reason: '仮説が見つかりません' };

  // Already-graduated hypotheses are frozen — re-opening would let an agent
  // overturn a proven finding without going through a deliberate reconsider step.
  if (row.validationStatus === 'validated' || row.validationStatus === 'rejected') {
    return {
      ok: false,
      reason: `この仮説は既に ${toStatus(row.validationStatus)} です（再評価は手動で）`,
      status: toStatus(row.validationStatus),
    };
  }

  const evidence = parseEvidence(row.tags);

  // Idempotent: never record the same task's outcome evidence (or an identical
  // artifact on the same side) twice. recordTaskOutcome can fire multiple times
  // per task (re-blocks / re-runs), and each call re-recorded the SAME evidence —
  // which duplicated it in the UI and falsely inflated confidence (3 copies of one
  // task's "completed" reading pushed a hypothesis most of the way to graduation
  // on a single real signal). Skip the push AND the confidence update on a dup.
  const isDuplicate = evidence.some(
    (e) =>
      e.stance === ev.stance &&
      ((ev.taskId != null && e.taskId === ev.taskId) || e.artifact === ev.artifact.trim()),
  );
  if (isDuplicate) {
    return {
      ok: true,
      confidence: row.confidence,
      status: toStatus(row.validationStatus),
      graduated: false,
    };
  }

  const sanDetail = sanitizeMarkdownContent(ev.detail ?? '');
  evidence.push({
    stance: ev.stance,
    detail: sanDetail.content.trim(),
    artifact: ev.artifact.trim(),
    taskId: ev.taskId ?? null,
    phase: ev.phase ?? null,
    at: new Date().toISOString(),
  });

  // Bayesian-ish update: 'for' moves confidence toward 1, 'against' toward 0,
  // each by a fixed fraction of the remaining distance. A DECISIVE verdict (an
  // explicit verification, not a weak completion proxy) instead jumps straight to
  // the graduation/refutation threshold so one genuine verification settles it.
  let confidence = row.confidence;
  if (ev.decisive) {
    confidence =
      ev.stance === 'for' ? Math.max(confidence, GRADUATE_AT) : Math.min(confidence, REFUTE_AT);
  } else {
    confidence =
      ev.stance === 'for'
        ? confidence + (1 - confidence) * EVIDENCE_STEP
        : confidence - confidence * EVIDENCE_STEP;
  }
  confidence = Math.min(1, Math.max(0, confidence));

  const hasConcreteFor = evidence.some((e) => e.stance === 'for');
  const hasConcreteAgainst = evidence.some((e) => e.stance === 'against');

  let validationStatus = 'pending';
  let validatedAt: Date | null = null;
  let validationMethod: string | null = null;
  let graduated = false;
  if (confidence >= GRADUATE_AT && hasConcreteFor) {
    validationStatus = 'validated';
    validatedAt = new Date();
    validationMethod = ev.phase ? `evidence:${ev.phase}` : 'evidence';
    graduated = true;
  } else if (confidence <= REFUTE_AT && hasConcreteAgainst) {
    validationStatus = 'rejected';
    validatedAt = new Date();
    validationMethod = ev.phase ? `evidence:${ev.phase}` : 'evidence';
    graduated = true;
  }

  await prisma.knowledgeEntry.update({
    where: { id: hypothesisId },
    data: {
      tags: JSON.stringify({ evidence }),
      confidence,
      validationStatus,
      validatedAt,
      validationMethod,
      // A graduated hypothesis is now established knowledge — bump access so the
      // KB recall/forgetting machinery treats it as freshly reinforced.
      accessCount: { increment: 1 },
      lastAccessedAt: new Date(),
    },
  });

  if (graduated) {
    log.info(
      { hypothesisId, status: toStatus(validationStatus), confidence },
      'Hypothesis graduated',
    );
  }
  return { ok: true, confidence, status: toStatus(validationStatus), graduated };
}
