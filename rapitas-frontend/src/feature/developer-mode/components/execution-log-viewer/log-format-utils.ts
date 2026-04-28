/**
 * execution-log-viewer/log-format-utils.ts
 *
 * Pure utility functions for parsing and formatting raw log strings.
 * No React or side-effect dependencies; safe to call in useMemo/render.
 */

/**
 * Determine if a string looks like a file-system path or source file name.
 *
 * @param value - String to test. / 判定対象の文字列。
 * @returns `true` when the string resembles a file path. / ファイルパスに見える場合 `true`。
 */
export function isFilePath(value: string): boolean {
  return /^[a-zA-Z]?:?[/\\]/.test(value) || /\.(ts|tsx|js|jsx|json|md|css|prisma)$/.test(value);
}

/**
 * Recursively format a nested object value into a readable string.
 *
 * Small objects (≤2 scalar fields) are rendered inline; larger ones use
 * multi-line indentation so they remain readable in the log panel.
 *
 * @param value - Value to format. / フォーマット対象の値。
 * @param indent - Current indentation depth (default 0). / 現在のインデント深さ（デフォルト 0）。
 * @returns Human-readable string representation. / 人間が読みやすい文字列。
 */
export function formatNestedValue(value: unknown, indent: number = 0): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') {
    const str = String(value);
    if (isFilePath(str)) return str; // Keep file paths as-is
    return str;
  }

  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return '{}';
  if (entries.length <= 2 && !entries.some(([, v]) => typeof v === 'object')) {
    // Display small objects inline
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
  }

  const prefix = '  '.repeat(indent + 1);
  const lines = entries.map(([k, v]) => {
    if (typeof v === 'object' && v !== null) {
      return `${prefix}${k}: ${formatNestedValue(v, indent + 1)}`;
    }
    return `${prefix}${k}: ${v}`;
  });
  return `\n${lines.join('\n')}`;
}

/** Result returned by {@link formatLogLine}. */
export type FormattedLogLine = {
  formatted: string;
  hasJson: boolean;
  isError?: boolean;
  isPhaseTransition?: boolean;
  filePaths?: string[];
};

/**
 * Parse a raw log string and return a display-ready representation.
 *
 * Detects inline JSON and workflow phase-transition markers, extracts
 * file paths for syntax colouring, and flags error entries.
 *
 * @param log - Raw log string from the execution stream. / 実行ストリームの生ログ文字列。
 * @returns Formatted log line metadata. / フォーマット済みのログ行メタデータ。
 */
export function formatLogLine(log: string): FormattedLogLine {
  // Detect workflow phase transitions
  const phaseMatch = log.match(
    /\[(research|plan|implement|verify|draft|plan_created|plan_approved|in_progress|completed)\]/i,
  );
  if (phaseMatch) {
    return { formatted: log, hasJson: false, isPhaseTransition: true };
  }

  // Check for JSON strings ({...} pattern)
  const jsonMatch = log.match(/^(.*?)(\{[\s\S]*\})(.*)$/);
  if (!jsonMatch) return { formatted: log, hasJson: false };

  const [, prefix, jsonStr, suffix] = jsonMatch;
  try {
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed !== 'object' || parsed === null) {
      return { formatted: log, hasJson: false };
    }

    const obj = parsed as Record<string, unknown>;
    const parts: string[] = [];
    const filePaths: string[] = [];
    const isError = !!obj.error;

    // Display frequently used fields first
    const priorityKeys = ['message', 'msg', 'status', 'type', 'error', 'taskId', 'agentId'];
    for (const key of priorityKeys) {
      if (key in obj && obj[key] !== null && obj[key] !== undefined) {
        const val = obj[key];
        if (typeof val === 'object') {
          parts.push(`${key}: ${formatNestedValue(val)}`);
        } else {
          const strVal = String(val);
          if (isFilePath(strVal)) filePaths.push(strVal);
          parts.push(`${key}: ${strVal}`);
        }
      }
    }

    // Remaining fields (with nesting support)
    const skipKeys = new Set([...priorityKeys, 'timestamp', 'level']);
    for (const [key, value] of Object.entries(obj)) {
      if (skipKeys.has(key) || value === null || value === undefined) continue;
      if (typeof value === 'object') {
        parts.push(`${key}: ${formatNestedValue(value)}`);
      } else {
        const strVal = String(value);
        if (isFilePath(strVal)) filePaths.push(strVal);
        parts.push(`${key}: ${strVal}`);
      }
    }

    const formattedJson = parts.join(' | ');
    return {
      formatted: `${prefix}${formattedJson}${suffix}`.trim(),
      hasJson: true,
      isError,
      filePaths: filePaths.length > 0 ? filePaths : undefined,
    };
  } catch {
    return { formatted: log, hasJson: false };
  }
}
