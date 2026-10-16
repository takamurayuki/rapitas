/**
 * ci-failure.test
 *
 * Verifies the ci-failure scenario correctly flags a failing blocking check.
 */
import { describe, it, expect } from 'bun:test';
import { run } from '../ci-failure';

describe('ci-failure scenario', () => {
  it('reports passed=true when the aggregate CI state is fail', async () => {
    const result = await run({ port: 3211, baseUrl: 'http://localhost:3211', cwd: '.' });
    expect(result.name).toBe('ci-failure');
    expect(result.passed).toBe(true);
  });
});
