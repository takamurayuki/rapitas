/**
 * cli-immediate-exit.test
 *
 * Verifies the scenario correctly classifies an immediately-exiting process.
 */
import { describe, it, expect } from 'bun:test';
import { run } from '../cli-immediate-exit';

describe('cli-immediate-exit scenario', () => {
  it('reports passed=true for a fast non-zero exit', async () => {
    const result = await run({ port: 3211, baseUrl: 'http://localhost:3211', cwd: '.' });
    expect(result.name).toBe('cli-immediate-exit');
    expect(result.passed).toBe(true);
  });
});
