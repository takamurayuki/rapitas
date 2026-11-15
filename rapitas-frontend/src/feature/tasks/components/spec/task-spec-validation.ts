/**
 * task-spec-validation
 *
 * Which spec fields a new task still needs, as the form asks for them
 * (#1555). Mirrors the backend's rule (`services/task/task-spec-requirements.ts`):
 * a development-project task needs its goals and at least one completion
 * criterion — an acceptance criterion or something the person checks.
 * Personal tasks need neither. Pure; messages are i18n keys under `task`.
 */

/** What finishing hands over, in the order the form offers them (PR is the default). */
export const DELIVERABLE_OPTIONS = ['pr', 'note', 'report', 'decision'] as const;

/** One of {@link DELIVERABLE_OPTIONS}. */
export type DeliverableOption = (typeof DELIVERABLE_OPTIONS)[number];

/** The spec text fields, one item per line. */
export interface SpecTextValues {
  goals: string;
  acceptanceCriteria: string;
  userAcceptanceChecks: string;
}

/** Field → i18n key of the message to show. Empty when nothing is missing. */
export interface SpecErrors {
  goals?: 'specErrorGoals';
  completionCriteria?: 'specErrorCompletion';
}

/**
 * Splits a newline-separated block into trimmed, non-empty items.
 *
 * @param raw - The textarea's value / 入力欄の値
 * @returns One item per line / 1行1項目の配列
 */
export function toLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The required fields the form must still ask for.
 *
 * @param values - The spec fields as typed / 入力中の仕様
 * @param isDevelopment - Whether the chosen theme is a development project / 開発プロジェクトか
 * @returns Messages keyed by field / 項目ごとのメッセージキー
 */
export function specErrors(values: SpecTextValues, isDevelopment: boolean): SpecErrors {
  if (!isDevelopment) return {};
  const errors: SpecErrors = {};
  if (toLines(values.goals).length === 0) errors.goals = 'specErrorGoals';
  if (
    toLines(values.acceptanceCriteria).length === 0 &&
    toLines(values.userAcceptanceChecks).length === 0
  ) {
    errors.completionCriteria = 'specErrorCompletion';
  }
  return errors;
}
