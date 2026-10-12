/**
 * deviation-mask tests
 */
import { describe, expect, test } from 'bun:test';
import { maskDeviationText } from './deviation-mask';

// NOTE: Fake secrets are assembled at runtime so secret scanners do not flag
// this file (see gitleaks history-scan behavior).
const SK = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2';
const GHP = 'ghp_' + 'A'.repeat(36);
const AKIA = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const JWT =
  'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NSJ9' + '.' + 'c2lnbmF0dXJlLXZhbHVl';

describe('maskDeviationText', () => {
  const cases: Array<[string, string, string]> = [
    ['anthropic/openai key', `curl -H "x-api-key: ${SK}"`, SK],
    ['github PAT', `git push https://${GHP}@github.com/x`, GHP],
    ['bearer', 'Authorization: Bearer abc.def-ghi', 'abc.def-ghi'],
    ['aws key', `aws s3 ls # ${AKIA}`, AKIA],
    ['url credentials', 'postgres://user:hunter2pass@db:5432/x', 'hunter2pass'],
    ['env assignment', 'OPENAI_API_KEY=plainvalue123 bun run x', 'plainvalue123'],
    ['quoted env assignment', `export DB_PASSWORD="s3cr3t value"`, 's3cr3t value'],
    ['jwt', `token is ${JWT}`, JWT],
  ];
  for (const [name, input, secret] of cases) {
    test(`masks ${name}`, () => {
      const out = maskDeviationText(input);
      expect(out).not.toContain(secret);
      expect(out).toContain('[REDACTED]');
    });
  }

  test('leaves ordinary text untouched', () => {
    const text = 'git status && bun test services/a.test.ts NODE_ENV=test';
    expect(maskDeviationText(text)).toBe(text);
  });

  test('keeps the variable name of a masked assignment', () => {
    expect(maskDeviationText('GITHUB_TOKEN=abcdef')).toBe('GITHUB_TOKEN=[REDACTED]');
  });
});
