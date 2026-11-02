/**
 * Database Helper Utilities
 * Functions for JSON field handling and ID parsing
 */
import { INVALID_ID } from '../common/error-messages';
import { isValidEntityId } from '../common/id-validation';

/**
 * Get labels as an array
 * Handles both JSON strings and object arrays
 */
export function getLabelsArray(labels: unknown): string[] {
  if (!labels) return [];

  // String case (JSON)
  if (typeof labels === 'string') {
    try {
      const parsed = JSON.parse(labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // intentionally ignore parse errors, return empty array
      return [];
    }
  }

  // Array case
  if (Array.isArray(labels)) {
    // Object array (PostgreSQL relation)
    if (labels.length > 0 && typeof labels[0] === 'object' && labels[0]?.name) {
      return labels.map((l: { name: string }) => l.name);
    }
    // String array
    return labels.filter((l: unknown) => typeof l === 'string');
  }

  return [];
}

/**
 * Convert value to JSON string
 */
export function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Parse JSON string to object
 * Returns the value as-is if already an object
 */
export function fromJsonString<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      // intentionally ignore parse errors, return null
      return null;
    }
  }
  // Already an object (PostgreSQL compatible)
  return value as T;
}

/**
 * Parse an id path parameter, refusing anything that is not exactly a safe
 * positive integer.
 *
 * NOTE(#1335 review): this was `parseInt` guarded by `isNaN`, and `parseInt`
 * stops at the first character it cannot read — so `42abc`, `5e2`, `5.9` and
 * `5 OR 1=1` all resolved to real row ids, `0x10` became 0, and a 20-digit
 * number became an unsafe integer. Across the 37 call sites that reach rows
 * through this helper, a PATCH or DELETE naming one resource could modify
 * another. The test file had asserted the `42abc -> 42` behaviour as intended.
 *
 * @param id - The raw path segment / 生のパス要素
 * @returns The validated id / 検証済みの id
 * @throws {Error} INVALID_ID when it is not a safe positive integer / 安全な正整数でない場合
 */
export function parseId(id: string): number {
  if (!isValidEntityId(id)) {
    throw new Error(INVALID_ID);
  }
  return Number(id);
}
