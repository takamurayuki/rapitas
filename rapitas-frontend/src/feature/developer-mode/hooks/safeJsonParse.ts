/**
 * safeJsonParse
 *
 * Utility for safely parsing JSON responses from the backend API.
 * Distinguishes between incomplete JSON, database errors, and plain-text
 * error responses so callers can map them to user-friendly messages.
 * Not responsible for UI state or error display.
 */

export interface SafeJsonParseResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Parse a raw response string into a typed result without throwing.
 *
 * Validates basic structure completeness (matching braces/brackets) before
 * attempting JSON.parse, and detects common non-JSON error patterns.
 *
 * @param text - Raw HTTP response body text / <HTTPレスポンスの生テキスト>
 * @returns SafeJsonParseResult with success flag and data or error message
 */
export function safeJsonParse(text: string): SafeJsonParseResult {
  // Basic validation
  if (!text || typeof text !== 'string') {
    return { success: false, error: 'Empty or invalid response text' };
  }

  const trimmed = text.trim();

  // Check if it looks like JSON first (most common case)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // Check if JSON appears complete (basic bracket matching)
    if (trimmed.startsWith('{') && !trimmed.endsWith('}')) {
      return { success: false, error: 'Incomplete JSON object detected' };
    }
    if (trimmed.startsWith('[') && !trimmed.endsWith(']')) {
      return { success: false, error: 'Incomplete JSON array detected' };
    }

    try {
      const data = JSON.parse(trimmed);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: `JSON parse failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Non-JSON response — detect specific error patterns
  if (
    trimmed.startsWith('Invalid `prisma') ||
    trimmed.startsWith('Invalid `p') ||
    trimmed.includes('PrismaClient') ||
    trimmed.includes('@prisma/client')
  ) {
    return { success: false, error: 'Database query error detected' };
  }

  if (trimmed.startsWith('Error:') || trimmed.startsWith('ERROR:')) {
    return { success: false, error: trimmed };
  }

  return { success: false, error: 'Response is not JSON format' };
}
