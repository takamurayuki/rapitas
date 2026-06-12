/**
 * spec-array
 *
 * Parses the JSON-array string columns (goals / constraints / acceptanceCriteria,
 * stored the same way as `labels`) into a clean string array. Tolerant of null,
 * malformed JSON, and non-string elements — never throws.
 */

/**
 * Parses a JSON-array spec column into a string array.
 *
 * @param value - Raw JSON-array string column value / JSON配列文字列のカラム値
 * @returns String array (empty on null/invalid) / 文字列配列（null・不正時は空配列）
 */
export function parseSpecArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
