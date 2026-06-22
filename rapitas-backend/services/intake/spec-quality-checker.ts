/**
 * Spec Quality Checker
 *
 * Pure, side-effect-free heuristics that judge whether a task's structured
 * spec (goals / constraints / acceptance criteria) is substantial enough to
 * drive autonomous research and implementation.
 * Does NOT read/write the database, derive specs, or call any AI — callers do.
 */

/** Free-text description shorter than this reads as under-specified. */
export const MIN_DESCRIPTION_LENGTH = 50;

/** Score (0..100) at/above which a spec is considered workable without asking. */
export const ADEQUATE_SCORE = 70;

/** A field within the structured task spec. */
export type SpecField = 'goals' | 'constraints' | 'acceptanceCriteria';

/** The subset of a Task row this checker reads. */
export interface SpecQualityInput {
  description: string | null;
  /** Stored as a JSON-array string, an actual array, or null (mirrors `labels`). */
  goals: unknown;
  constraints: unknown;
  acceptanceCriteria: unknown;
}

/** Outcome of a spec-quality evaluation. */
export interface SpecQualityResult {
  /** True when the spec is substantial enough to proceed without clarification. */
  isAdequate: boolean;
  /** Structured spec fields that are empty / missing. */
  missing: SpecField[];
  /** 0..100 heuristic confidence that the spec is workable. */
  score: number;
  /** Human-readable reasons, used to seed a clarifying question. / 質問文の根拠 */
  reasons: string[];
}

/** The three structured spec fields, in display order. */
const SPEC_FIELDS: readonly SpecField[] = ['goals', 'constraints', 'acceptanceCriteria'];

/** Per-field score weights — goals + acceptance dominate (their sum reaches ADEQUATE_SCORE). */
const FIELD_WEIGHTS: Record<SpecField, number> = {
  goals: 40,
  acceptanceCriteria: 40,
  constraints: 10,
};

/** Bonus for a non-trivial free-text description. */
const DESCRIPTION_WEIGHT = 10;

/** Japanese labels for each spec field, used in clarifying-question text. */
const FIELD_LABELS: Record<SpecField, string> = {
  goals: '達成すべきゴール (goals)',
  constraints: '守るべき制約 (constraints)',
  acceptanceCriteria: '完了を判定する受入基準 (acceptanceCriteria)',
};

/**
 * Parse a spec field that may be a JSON-array string, an actual array, or null.
 * Never throws — malformed input yields an empty array.
 *
 * @param value - Raw stored value. / 保存された生の値
 * @returns Cleaned, trimmed, non-empty strings. / 整形済み文字列配列
 */
export function parseSpecArray(value: unknown): string[] {
  const fromUnknown = (v: unknown): string[] => {
    if (Array.isArray(v)) {
      return v.filter((x): x is string => typeof x === 'string');
    }
    if (typeof v === 'string' && v.trim()) {
      try {
        const parsed: unknown = JSON.parse(v);
        return Array.isArray(parsed)
          ? parsed.filter((x): x is string => typeof x === 'string')
          : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  return fromUnknown(value)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Merge an existing spec value with newly-derived items (union, de-duplicated,
 * order-preserving, capped). Used to enrich a thin spec without losing what the
 * user already wrote.
 *
 * @param existing - Current stored value (JSON string / array / null). / 既存値
 * @param derived - Newly derived items. / 新規導出値
 * @param cap - Maximum number of items to keep. / 上限件数
 * @returns Merged unique item list. / マージ済みの一意な配列
 */
export function mergeSpecField(existing: unknown, derived: string[], cap = 6): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const item of [...parseSpecArray(existing), ...derived.map((s) => s.trim())]) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    merged.push(item);
    if (merged.length >= cap) break;
  }
  return merged;
}

/**
 * Evaluate whether a task's spec is substantial enough to run autonomously.
 *
 * Scoring: goals (+40) and acceptanceCriteria (+40) carry the weight — together
 * they reach {@link ADEQUATE_SCORE}. constraints (+10) and a non-trivial
 * description (+10) are supporting signals only.
 *
 * @param task - The task spec fields to evaluate. / 評価対象のタスク仕様
 * @returns Adequacy verdict, missing fields, score, and reasons. / 判定結果
 */
export function checkSpecQuality(task: SpecQualityInput): SpecQualityResult {
  const present: Record<SpecField, string[]> = {
    goals: parseSpecArray(task.goals),
    constraints: parseSpecArray(task.constraints),
    acceptanceCriteria: parseSpecArray(task.acceptanceCriteria),
  };

  const missing = SPEC_FIELDS.filter((f) => present[f].length === 0);

  let score = 0;
  for (const f of SPEC_FIELDS) {
    if (present[f].length > 0) score += FIELD_WEIGHTS[f];
  }
  const descLength = (task.description ?? '').trim().length;
  if (descLength >= MIN_DESCRIPTION_LENGTH) score += DESCRIPTION_WEIGHT;

  const reasons: string[] = [];
  for (const f of missing) {
    if (f === 'goals' || f === 'acceptanceCriteria') {
      reasons.push(`${FIELD_LABELS[f]} が未指定です。`);
    }
  }
  if (descLength < MIN_DESCRIPTION_LENGTH) {
    reasons.push(`説明が短く (${descLength}文字)、意図を機械的に判断できません。`);
  }

  return { isAdequate: score >= ADEQUATE_SCORE, missing, score, reasons };
}

/** Expose field labels for question-template generation. / 質問テンプレート用ラベル */
export function specFieldLabel(field: SpecField): string {
  return FIELD_LABELS[field];
}
