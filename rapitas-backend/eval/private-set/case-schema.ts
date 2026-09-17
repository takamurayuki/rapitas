/**
 * Eval Private-Set Case Schema
 *
 * Shared type + validator for `eval/private-set/cases/*.json`. Kept separate
 * from eval-runner.ts so eval-collect-cases.ts can validate its own output
 * without importing the runner (which pulls in the Prisma client via other
 * paths at module scope).
 */

export const EVAL_CATEGORIES = [
  'bug-fix',
  'feature',
  'investigation-only',
  'multi-service',
  'failure-recovery',
] as const;

export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

export const EVAL_OUTCOMES = ['fail-to-pass', 'pass-to-pass'] as const;

export type EvalOutcome = (typeof EVAL_OUTCOMES)[number];

/** One private-set evaluation case. */
export interface EvalCase {
  id: string;
  category: EvalCategory;
  taskDescription: string;
  initialFiles: string[];
  acceptanceCheck: string;
  expectedOutcome: EvalOutcome;
}

/** Result of {@link validateEvalCase}. */
export interface EvalCaseValidation {
  ok: boolean;
  errors: string[];
}

/**
 * Validates that an unknown value conforms to the {@link EvalCase} schema.
 *
 * @param value - Parsed JSON candidate / パース済みJSON候補
 * @returns Validation result with a human-readable error list / 検証結果とエラー一覧
 */
export function validateEvalCase(value: unknown): EvalCaseValidation {
  const errors: string[] = [];
  if (typeof value !== 'object' || value === null) {
    return { ok: false, errors: ['case is not an object'] };
  }
  const c = value as Record<string, unknown>;

  if (typeof c.id !== 'string' || c.id.trim() === '') errors.push('id must be a non-empty string');
  if (typeof c.category !== 'string' || !EVAL_CATEGORIES.includes(c.category as EvalCategory)) {
    errors.push(`category must be one of ${EVAL_CATEGORIES.join(', ')}`);
  }
  if (typeof c.taskDescription !== 'string' || c.taskDescription.trim() === '') {
    errors.push('taskDescription must be a non-empty string');
  }
  if (!Array.isArray(c.initialFiles) || !c.initialFiles.every((f) => typeof f === 'string')) {
    errors.push('initialFiles must be a string array');
  }
  if (typeof c.acceptanceCheck !== 'string' || c.acceptanceCheck.trim() === '') {
    errors.push('acceptanceCheck must be a non-empty string');
  }
  if (
    typeof c.expectedOutcome !== 'string' ||
    !EVAL_OUTCOMES.includes(c.expectedOutcome as EvalOutcome)
  ) {
    errors.push(`expectedOutcome must be one of ${EVAL_OUTCOMES.join(', ')}`);
  }

  return { ok: errors.length === 0, errors };
}
