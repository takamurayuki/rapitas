/**
 * HypothesisRow
 *
 * The stored shape of a ledger hypothesis (a KnowledgeEntry with sourceType
 * 'hypothesis') and the mapping to the entry this domain exposes.
 * No queries and no writes: hypothesis-queries.ts reads and
 * hypothesis-service.ts writes, and both share this mapping so the two cannot
 * drift apart.
 */
import { normalizeDomain } from './hypothesis-types';
import type { EvidenceStance, HypothesisDomain, HypothesisStatus } from './hypothesis-types';

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

export const HYP_SELECT = {
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
export function toStatus(validationStatus: string): HypothesisStatus {
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
export function parseEvidence(tags: string): HypothesisEvidence[] {
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
export function toHypothesisEntry(row: HypothesisRow): HypothesisEntry {
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
