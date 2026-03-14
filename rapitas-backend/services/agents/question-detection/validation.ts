/**
 * Question Detection System - Validation & Parsing
 */

import type { QuestionKey } from './types';

/**
 * Validates whether the given object is a valid QuestionKey.
 */
export function validateQuestionKey(key: unknown): key is QuestionKey {
  if (!key || typeof key !== 'object') {
    return false;
  }

  const obj = key as Record<string, unknown>;

  if (
    typeof obj.status !== 'string' ||
    typeof obj.question_id !== 'string' ||
    typeof obj.question_type !== 'string' ||
    typeof obj.requires_response !== 'boolean'
  ) {
    return false;
  }

  const validStatuses = ['awaiting_user_input', 'processing', 'completed'];
  if (!validStatuses.includes(obj.status)) {
    return false;
  }

  const validTypes = ['clarification', 'confirmation', 'selection'];
  if (!validTypes.includes(obj.question_type)) {
    return false;
  }

  if (obj.timeout_seconds !== undefined && typeof obj.timeout_seconds !== 'number') {
    return false;
  }

  return true;
}

/**
 * Parses a QuestionKey from a JSON string (for future direct key return approach).
 */
export function parseQuestionKeyFromString(str: string): QuestionKey | null {
  try {
    const parsed = JSON.parse(str);
    if (validateQuestionKey(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts a QuestionKey from an object (for future direct key return approach).
 */
export function extractQuestionKeyFromObject(obj: Record<string, unknown>): QuestionKey | null {
  if (validateQuestionKey(obj)) {
    return obj;
  }

  // Search common nested locations
  const possibleLocations = ['questionKey', 'question_key', 'key', 'response'];
  for (const loc of possibleLocations) {
    if (obj[loc] && validateQuestionKey(obj[loc])) {
      return obj[loc] as QuestionKey;
    }
  }

  return null;
}
