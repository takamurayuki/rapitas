/**
 * goals-api.test
 *
 * A refused confirmation must show the person the backend's own sentence
 * ("すべての達成条件を確認してください"), not the raw "API Error: 409 …" text.
 */
import { describe, it, expect } from 'vitest';
import { apiErrorMessage } from '../goals-api';

describe('apiErrorMessage', () => {
  it('extracts the error sentence from an apiFetch error', () => {
    const err = new Error(
      'API Error: 409 (POST /milestones/3/confirm) - {"error":"すべての達成条件を確認してください","code":"milestone_criteria_unchecked"}',
    );
    expect(apiErrorMessage(err)).toBe('すべての達成条件を確認してください');
  });

  it.each([
    new Error('API Error: 500 (GET /goals) - Internal Server Error'),
    new Error('timeout'),
    'not an error',
    null,
  ])('returns null when there is no backend sentence (%p)', (err) => {
    expect(apiErrorMessage(err)).toBeNull();
  });
});
