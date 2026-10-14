/**
 * plan-out-of-scope-criteria
 *
 * Reads the acceptance criteria a plan.md explicitly declares out of scope and
 * matches them against verify.md's non-passing rows. Not responsible for the
 * verdict itself — phase-output-validator decides what to do with the answer.
 */
import { collectNonpassingRows } from './verify-scan-text';

const FENCE_RE = /```json:out-of-scope-criteria[^\S\n]*\n([\s\S]*?)\n[ \t]*```/g;

/**
 * Extract the criterion numbers a plan declares out of scope.
 *
 * Fails open to "nothing declared" on any ambiguity (several fences, bad JSON,
 * wrong version, non-integer id, empty reason) so a sloppy declaration can
 * never loosen the acceptance criteria.
 *
 * @param planContent - plan.md body, if any / plan.md 本文
 * @returns Declared criterion numbers, deduplicated / 宣言済み基準番号（重複なし）
 */
export function parseOutOfScopeCriteria(planContent: string | null | undefined): number[] {
  if (!planContent) return [];
  const fences = [...planContent.matchAll(FENCE_RE)];
  if (fences.length !== 1) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fences[0][1]);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];
  const { version, criteria } = parsed as { version?: unknown; criteria?: unknown };
  if (version !== 1 || !Array.isArray(criteria)) return [];
  const ids = new Set<number>();
  for (const entry of criteria) {
    if (typeof entry !== 'object' || entry === null) return [];
    const { id, reason } = entry as { id?: unknown; reason?: unknown };
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return [];
    if (typeof reason !== 'string' || reason.trim().length === 0) return [];
    ids.add(id);
  }
  return [...ids];
}

/** Criterion number a non-passing row leads with, or null. Integer match only. */
function leadingCriterionNumber(row: string): number | null {
  const head = row
    .replace(/^[|*>\s-]+/, '')
    .replace(/^(?:⚠️?|❌|✅)\s*/, '')
    .replace(/^[|*\s]+/, '');
  const m =
    head.match(/^(?:受入基準|受入条件|基準|条件|AC)\s*[-#]?\s*(\d+)(?!\d)/i) ??
    head.match(/^#(\d+)(?!\d)/) ??
    head.match(/^(\d+)(?!\d)\s*(?:[|.):：]|$)/);
  return m ? Number(m[1]) : null;
}

/**
 * Whether EVERY non-passing row of the report is a declared out-of-scope
 * criterion (and at least one row exists).
 *
 * @param verifyContent - verify.md body / verify.md 本文
 * @param declaredIds - Criterion numbers from parseOutOfScopeCriteria / 宣言済み番号
 * @returns true only when the remaining failures are all declared / 全未達が宣言済みなら true
 */
export function isDeclaredScopeReductionOnly(
  verifyContent: string,
  declaredIds: readonly number[],
): boolean {
  if (declaredIds.length === 0) return false;
  const rows = collectNonpassingRows(verifyContent);
  if (rows.length === 0) return false;
  return rows.every((row) => {
    const n = leadingCriterionNumber(row);
    return n !== null && declaredIds.includes(n);
  });
}
