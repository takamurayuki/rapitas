/**
 * error-messages.test
 *
 * Verifies that error-message constants are byte-identical to the original
 * inline literals they replaced. Any deviation would break existing API
 * consumers and test assertions that use .toBe() on these strings.
 */
import { describe, test, expect } from 'bun:test';
import { TASK_NOT_FOUND, INVALID_ID, RESOURCE_NOT_FOUND, VALIDATION_ERROR } from './error-messages';

describe('error-messages SSOT', () => {
  test('TASK_NOT_FOUND matches original literal', () => {
    expect(TASK_NOT_FOUND).toBe('タスクが見つかりません');
  });

  test('INVALID_ID matches original literal', () => {
    expect(INVALID_ID).toBe('無効なIDです');
  });

  test('RESOURCE_NOT_FOUND matches original literal', () => {
    expect(RESOURCE_NOT_FOUND).toBe('Resource not found');
  });

  test('VALIDATION_ERROR matches original literal', () => {
    expect(VALIDATION_ERROR).toBe('Validation error');
  });

  test('all constants are strings', () => {
    expect(typeof TASK_NOT_FOUND).toBe('string');
    expect(typeof INVALID_ID).toBe('string');
    expect(typeof RESOURCE_NOT_FOUND).toBe('string');
    expect(typeof VALIDATION_ERROR).toBe('string');
  });
});
