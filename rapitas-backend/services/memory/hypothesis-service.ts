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

const log = createLogger('memory:hypothesis');

/** Domain a hypothesis is about — bounds the ledger to reasoning-relevant claims. */
export type HypothesisDomain =
  | 'codebase'
  | 'agent-behavior'
  | 'performance'
  | 'architecture'
  | 'other';
/** Lifecycle: open (untested) → supported / refuted / inconclusive. */
export type HypothesisStatus = 'open' | 'supported' | 'refuted' | 'inconclusive';
/** Whether a piece of evidence supports or opposes the hypothesis. */
export type EvidenceStance = 'for' | 'against';

const VALID_DOMAINS: readonly HypothesisDomain[] = [
  'codebase',
  'agent-behavior',
  'performance',
  'architecture',
  'other',
];

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

/** A single recorded observation bearing on a hypothesis. */
export interface HypothesisEvidence {
  stance: EvidenceStance;
  /** Plain-language observation. / 平易な観察事実 */
  detail: string;
  /** Concrete anchor: file:line / test name / measurement / #PR. / 具体的根拠 */
  artifact: string;
  /** Task the evidence came from, if any. / 証拠が得られたタスク */
  taskId: number | null;
  /** Workflow phase the evidence came from (research/implement/verify). */
  phase: string | null;
  /** ISO timestamp the evidence was recorded. */
  at: string;
}

export interface HypothesisEntry {
  id: number;
  statement: string;
  rationale: string;
  domain: HypothesisDomain;
  status: HypothesisStatus;
  confidence: number;
  evidence: HypothesisEvidence[];
  validationMethod: string | null;
  validatedAt: Date | null;
  themeId: number | null;
  originTaskId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

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

/** Coerce an arbitrary value to a valid domain (default 'codebase'). */
export function normalizeDomain(value: unknown): HypothesisDomain {
  return VALID_DOMAINS.includes(value as HypothesisDomain)
    ? (value as HypothesisDomain)
    : 'codebase';
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

interface HypothesisRow {
  id: number;
  title: string;
  content: string;
  category: string;
  tags: string;
  sourceId: string | null;
  confidence: number;
  validationStatus: string;
  validationMethod: string | null;
  validatedAt: Date | null;
  themeId: number | null;
  taskId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const HYP_SELECT = {
  id: true,
  title: true,
  content: true,
  category: true,
  tags: true,
  sourceId: true,
  confidence: true,
  validationStatus: true,
  validationMethod: true,
  validatedAt: true,
  themeId: true,
  taskId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** validationStatus (storage) → HypothesisStatus (domain). */
function toStatus(validationStatus: string): HypothesisStatus {
  switch (validationStatus) {
    case 'validated':
      return 'supported';
    case 'rejected':
      return 'refuted';
    case 'conflict':
      return 'inconclusive';
    default:
      return 'open';
  }
}

/** Parse the evidence array stored in the entry's tags JSON (tolerant). */
function parseEvidence(tags: string): HypothesisEvidence[] {
  try {
    const parsed = JSON.parse(tags || '{}') as { evidence?: HypothesisEvidence[] };
    if (!Array.isArray(parsed.evidence)) return [];
    // Collapse duplicates already in storage (same task+stance, or identical
    // artifact+stance) so historical entries — written before the write-side
    // dedup — no longer show the same evidence two or three times in the UI.
    const seen = new Set<string>();
    return parsed.evidence.filter((e) => {
      const key = `${e.stance}|${e.taskId ?? ''}|${e.artifact ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

/** Map a KnowledgeEntry row to a HypothesisEntry. */
function toHypothesisEntry(row: HypothesisRow): HypothesisEntry {
  return {
    id: row.id,
    statement: row.title,
    rationale: row.content,
    domain: normalizeDomain(row.category),
    status: toStatus(row.validationStatus),
    confidence: row.confidence,
    evidence: parseEvidence(row.tags),
    validationMethod: row.validationMethod,
    validatedAt: row.validatedAt,
    themeId: row.themeId,
    originTaskId: row.taskId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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

/**
 * Lists hypotheses with optional filters.
 *
 * @param options - Filters (status/domain/theme) + pagination. / フィルタ
 * @returns Hypotheses and total count. / 仮説リストと総数
 */
export async function listHypotheses(options: {
  status?: HypothesisStatus | 'all';
  domain?: HypothesisDomain;
  themeId?: number;
  limit?: number;
  offset?: number;
}): Promise<{ hypotheses: HypothesisEntry[]; total: number }> {
  const { status = 'open', domain, themeId, limit = 20, offset = 0 } = options;

  const where: Record<string, unknown> = { sourceType: 'hypothesis', forgettingStage: 'active' };
  if (domain) where.category = domain;
  if (themeId) where.themeId = themeId;
  if (status === 'open') where.validationStatus = 'pending';
  else if (status === 'supported') where.validationStatus = 'validated';
  else if (status === 'refuted') where.validationStatus = 'rejected';
  else if (status === 'inconclusive') where.validationStatus = 'conflict';
  // status === 'all' → no validationStatus filter.

  const [rows, total] = await Promise.all([
    prisma.knowledgeEntry.findMany({
      where,
      orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
      skip: offset,
      select: HYP_SELECT,
    }),
    prisma.knowledgeEntry.count({ where }),
  ]);
  return { hypotheses: rows.map(toHypothesisEntry), total };
}

/**
 * Fetches a single hypothesis by id.
 *
 * @param id - Hypothesis id. / 仮説ID
 * @returns The hypothesis, or null when not found. / 仮説、無ければ null
 */
export async function getHypothesis(id: number): Promise<HypothesisEntry | null> {
  const row = await prisma.knowledgeEntry.findFirst({
    where: { id, sourceType: 'hypothesis' },
    select: HYP_SELECT,
  });
  return row ? toHypothesisEntry(row) : null;
}

/**
 * Manually overrides a hypothesis's status (e.g. a human marks it inconclusive).
 *
 * @param id - Hypothesis id. / 仮説ID
 * @param status - New status. / 新しい状態
 * @returns True when updated. / 更新できたか
 */
export async function setHypothesisStatus(id: number, status: HypothesisStatus): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { id, sourceType: 'hypothesis' },
    select: { id: true },
  });
  if (!existing) return false;
  const validationStatus =
    status === 'supported'
      ? 'validated'
      : status === 'refuted'
        ? 'rejected'
        : status === 'inconclusive'
          ? 'conflict'
          : 'pending';
  await prisma.knowledgeEntry.update({
    where: { id },
    data: {
      validationStatus,
      validatedAt: validationStatus === 'pending' ? null : new Date(),
    },
  });
  log.info({ id, status }, 'Hypothesis status manually set');
  return true;
}

/** Deletes a hypothesis. */
export async function deleteHypothesis(id: number): Promise<boolean> {
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { id, sourceType: 'hypothesis' },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.knowledgeEntry.delete({ where: { id } });
  return true;
}

/**
 * Counts hypotheses by status (for dashboards / stats).
 *
 * @returns Aggregate counts. / 集計
 */
export async function getHypothesisStats(): Promise<{
  open: number;
  supported: number;
  refuted: number;
  inconclusive: number;
}> {
  const base = { sourceType: 'hypothesis' as const, forgettingStage: 'active' };
  const [open, supported, refuted, inconclusive] = await Promise.all([
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'pending' } }),
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'validated' } }),
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'rejected' } }),
    prisma.knowledgeEntry.count({ where: { ...base, validationStatus: 'conflict' } }),
  ]);
  return { open, supported, refuted, inconclusive };
}
