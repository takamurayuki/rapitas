/**
 * json-extractor
 *
 * Bracket-aware JSON array extractor for LLM responses. Centralises the
 * extract → parse → validate pipeline so callers never inline greedy regex.
 */

/**
 * Extracts the first top-level JSON array from a text string using a
 * bracket-depth scanner.
 *
 * Unlike a greedy regex (`/\[[\s\S]*\]/`), this function correctly handles:
 * - `]` characters inside string literals
 * - Escaped quotes (`\"`) inside string literals
 * - Trailing text that contains `[` or `]` after the array ends
 * - Truncated responses (returns `null` instead of throwing)
 *
 * @param text - Raw text that may contain a JSON array / JSON配列を含む可能性のある生テキスト
 * @returns The extracted JSON array substring, or `null` if not found or unterminated / 抽出した配列文字列、見つからないか未終端の場合は `null`
 */
export function extractFirstJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  // Reached end of text without closing bracket — truncated input
  return null;
}

/**
 * Extracts and parses the first JSON array from an LLM response text.
 *
 * Combines `extractFirstJsonArray` with JSON.parse and an Array.isArray guard
 * so all three failure modes (not found, parse error, non-array) collapse to
 * a single `null` return.
 *
 * @param text - Raw LLM response text / LLMレスポンスのテキスト
 * @returns Typed array, or `null` on any failure / 型付き配列、失敗時は `null`
 */
export function parseJsonArray<T>(text: string): T[] | null {
  const raw = extractFirstJsonArray(text);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}
