/**
 * ラベルを配列として取得するヘルパー関数（SQLite/PostgreSQL両対応）
 * SQLiteではJSON文字列、PostgreSQLでは配列として保存される
 */
export function getLabelsArray(labels: unknown): string[] {
  if (!labels) return [];

  // 文字列の場合（SQLite JSON）
  if (typeof labels === 'string') {
    try {
      const parsed = JSON.parse(labels);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // 配列の場合
  if (Array.isArray(labels)) {
    return labels.filter((l): l is string => typeof l === 'string');
  }

  return [];
}

/**
 * ラベルが存在するかチェック
 */
export function hasLabels(labels: unknown): boolean {
  return getLabelsArray(labels).length > 0;
}
