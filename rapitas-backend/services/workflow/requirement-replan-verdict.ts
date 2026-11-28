/** Strict boundary for an independent judge; never treats malformed output as approval. */
import {
  replanSnapshotDigest,
  replanRequirementSources,
  type ReplanRequirementSource,
  validateReplanEvidence,
  type ReplanEvidence,
  type ReplanSnapshot,
} from './requirement-replan-evidence';

export type ReplanVerdict =
  | { kind: 'mismatch'; evidence: ReplanEvidence; reason: string }
  | { kind: 'no_mismatch'; reason: string }
  | { kind: 'unknown'; reason: string };

/** Resolve a bounded inclusive zero-based line range without changing source text. */
function sourceLines(text: string, range: unknown): string | null {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const [start, end] = range;
  const lines = text.split('\n');
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= lines.length ||
    end - start >= 20
  )
    return null;
  const quote = lines.slice(start, end + 1).join('\n');
  return quote.trim() ? quote : null;
}

/**
 * Check the judge's own structured fields for a concrete unmet requirement.
 * Never reads `reason`: words in free text must not open or close the hold.
 *
 * @param row - Parsed judge response / 判定役の応答
 * @returns The expected/observed pair, or the code naming the contradiction / 期待値と実測値、または食い違いのコード
 */
function readUnmetMeasurement(
  row: Record<string, unknown>,
): { expected: string; observed: string } | { conflict: string } {
  if (row.measuredResult !== 'failed') return { conflict: 'measured_result_not_failed' };
  const expected = typeof row.expected === 'string' ? row.expected.trim() : '';
  if (!expected) return { conflict: 'missing_expected' };
  const observed = typeof row.observed === 'string' ? row.observed.trim() : '';
  if (!observed) return { conflict: 'missing_observed' };
  if (observed === expected) return { conflict: 'observed_equals_expected' };
  return { expected, observed };
}

/** Parse only a complete JSON response and ground any claimed mismatch locally. */
export function parseReplanVerdict(content: string, snapshot: ReplanSnapshot): ReplanVerdict {
  let value: unknown;
  try {
    // Accept one whole JSON code fence, never extract a convenient object from prose.
    const trimmed = content.trim();
    const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
    value = JSON.parse(fence ? fence[1] : trimmed);
  } catch {
    return { kind: 'unknown', reason: 'invalid_json' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'unknown', reason: 'invalid_verdict' };
  }
  const row = value as Record<string, unknown>;
  if (typeof row.reason !== 'string' || !row.reason.trim()) {
    return { kind: 'unknown', reason: 'missing_reason' };
  }
  if (row.kind === 'unknown' || row.kind === 'no_mismatch') {
    return { kind: row.kind, reason: row.reason };
  }
  if (
    row.kind !== 'mismatch' ||
    row.requirementUnmet !== true ||
    row.planPreventsRequirement !== true ||
    row.preservesRequirements !== true ||
    row.requiresOverridingUserConstraint !== false ||
    typeof row.criterionIndex !== 'number'
  ) {
    return { kind: 'unknown', reason: 'incomplete_mismatch_verdict' };
  }
  const criterionSource = row.criterionSource ?? 'acceptanceCriteria';
  if (
    typeof criterionSource !== 'string' ||
    !['acceptanceCriteria', 'description', 'goals', 'constraints', 'title'].includes(
      criterionSource,
    )
  )
    return { kind: 'unknown', reason: 'invalid_requirement_source' };
  if (criterionSource !== 'acceptanceCriteria' && row.requirementIsRequestedOutcome !== true)
    return { kind: 'unknown', reason: 'unconfirmed_requirement_intent' };
  const criteria = replanRequirementSources(snapshot)[criterionSource as ReplanRequirementSource];
  const usesLines = 'planLines' in row || 'failureLines' in row;
  const criterion = usesLines ? criteria[row.criterionIndex] : row.criterion;
  const planQuote = usesLines ? sourceLines(snapshot.plan, row.planLines) : row.planQuote;
  const failureQuote = usesLines
    ? sourceLines(snapshot.verify, row.failureLines)
    : row.failureQuote;
  if (
    typeof criterion !== 'string' ||
    typeof planQuote !== 'string' ||
    typeof failureQuote !== 'string'
  ) {
    return { kind: 'unknown', reason: 'invalid_evidence_reference' };
  }
  const evidence: ReplanEvidence = {
    snapshotDigest: replanSnapshotDigest(snapshot),
    ...(criterionSource === 'acceptanceCriteria'
      ? {}
      : { criterionSource: criterionSource as ReplanRequirementSource }),
    criterionIndex: row.criterionIndex,
    criterion,
    planQuote,
    failureQuote,
  };
  const invalid = validateReplanEvidence(snapshot, evidence);
  if (invalid) return { kind: 'unknown', reason: invalid };
  // Checked last so every earlier `unknown` keeps its existing code. `unknown`
  // takes the service's continue path, which records this reason on the verify
  // transition instead of holding the task.
  const measured = readUnmetMeasurement(row);
  if ('conflict' in measured) {
    return {
      kind: 'unknown',
      reason: `verdict_reason_conflict:${measured.conflict}: ${row.reason}`,
    };
  }
  return { kind: 'mismatch', evidence: { ...evidence, ...measured }, reason: row.reason };
}
