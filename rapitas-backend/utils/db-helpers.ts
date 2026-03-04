/**
 * Database Helper Utilities
 * Functions for JSON field handling and ID parsing
 */

/**
 * Get labels as an array
 * Handles both JSON strings and object arrays
 */
export function getLabelsArray(labels: unknown): string[] {
  if (!labels) return [];

  // String case (JSON)
  if (typeof labels === "string") {
    try {
      const parsed = JSON.parse(labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Array case
  if (Array.isArray(labels)) {
    // Object array (PostgreSQL relation)
    if (labels.length > 0 && typeof labels[0] === "object" && labels[0]?.name) {
      return labels.map((l: { name: string }) => l.name);
    }
    // String array
    return labels.filter((l: unknown) => typeof l === "string");
  }

  return [];
}

/**
 * Convert value to JSON string
 */
export function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/**
 * Parse JSON string to object
 * Returns the value as-is if already an object
 */
export function fromJsonString<T = unknown>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  // Already an object (PostgreSQL compatible)
  return value as T;
}

/**
 * Parse ID parameter and validate
 * @throws Error if ID is invalid
 */
export function parseId(id: string): number {
  const parsed = parseInt(id);
  if (isNaN(parsed)) {
    throw new Error("無効なIDです");
  }
  return parsed;
}

