/**
 * task-criteria.utils
 *
 * Reads a task's completion-criteria columns (acceptanceCriteria /
 * userAcceptanceChecks) into display-ready string lists. Display only — the
 * create/edit forms serialise their own input.
 */

/**
 * Parse a criteria column into a list of non-blank, trimmed strings.
 *
 * The DB stores these columns as a JSON-encoded string array, but an array is
 * accepted too so callers holding already-decoded data need no special case.
 * Anything unreadable yields an empty list rather than throwing, matching the
 * mobile model's `_parseStringList`.
 *
 * @param raw - Column value from the task payload / タスク応答の列の値（JSON 文字列または配列）
 * @returns Trimmed non-empty criteria / 空白を除いた条件の配列（読めなければ空配列）
 */
export function parseCriteriaList(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    if (value.trim() === '') return [];
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}
