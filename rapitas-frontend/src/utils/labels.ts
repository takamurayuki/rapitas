/**
 * Helper function to get labels as array (supports both SQLite/PostgreSQL)
 * Stored as JSON string in SQLite, as array in PostgreSQL
 */
export function getLabelsArray(labels: unknown): string[] {
  if (!labels) return [];

  // String case (SQLite JSON)
  if (typeof labels === 'string') {
    try {
      const parsed = JSON.parse(labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // Array case
  if (Array.isArray(labels)) {
    return labels.filter((l): l is string => typeof l === 'string');
  }

  return [];
}

/**
 * Check if labels exist
 */
export function hasLabels(labels: unknown): boolean {
  return getLabelsArray(labels).length > 0;
}
