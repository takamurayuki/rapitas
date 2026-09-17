/**
 * pr-response-loss.test
 *
 * Verifies the pr-response-loss scenario detects the already-created PR
 * before a retry would claim the creation lock again.
 */
import { describe, it, expect } from 'bun:test';
import { run } from '../pr-response-loss';

describe('pr-response-loss scenario', () => {
  it('reports passed=true when the retry finds the existing PR', async () => {
    const result = await run({ port: 3211, baseUrl: 'http://localhost:3211', cwd: '.' });
    expect(result.name).toBe('pr-response-loss');
    expect(result.passed).toBe(true);
    expect(result.detail).toContain('#4242');
  });
});
