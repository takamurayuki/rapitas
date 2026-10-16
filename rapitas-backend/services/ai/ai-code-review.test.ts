/**
 * AICodeReview — postReviewToPR テスト
 *
 * postReviewToPR が runGhCommandWithBody 経由で正しい引数を渡すことを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

let ghClientCalls: Array<{ args: string[]; body: string | undefined; cwd: string | undefined }> =
  [];

mock.module('../github/gh-client', () => ({
  runGhCommandWithBody: async (args: string[], body?: string, cwd?: string) => {
    ghClientCalls.push({ args, body, cwd });
    return '';
  },
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { postReviewToPR } = await import('./ai-code-review');

/** Build a minimal CodeReviewResult for tests. */
function makeReview(totalFindings: number) {
  return {
    riskLevel: 'low' as const,
    findings: Array.from({ length: totalFindings }, (_, i) => ({
      file: `file${i}.ts`,
      severity: 'warning' as const,
      category: 'best_practice' as const,
      message: `finding ${i}`,
    })),
    summary: 'テスト概要',
    reviewedFiles: 1,
    totalFindings,
  };
}

beforeEach(() => {
  ghClientCalls = [];
});

describe('postReviewToPR', () => {
  test('findings が 0 件のときは runGhCommandWithBody を呼ばないこと', async () => {
    await postReviewToPR('/repo', 10, makeReview(0));

    expect(ghClientCalls.length).toBe(0);
  });

  test('findings が 1 件以上のとき pr comment を runGhCommandWithBody 経由で呼ぶこと', async () => {
    await postReviewToPR('/repo', 42, makeReview(2));

    expect(ghClientCalls.length).toBe(1);
    const call = ghClientCalls[0];
    expect(call.args).toEqual(['pr', 'comment', '42']);
    expect(call.cwd).toBe('/repo');
    expect(typeof call.body).toBe('string');
    expect((call.body ?? '').length).toBeGreaterThan(0);
  });

  test('body に引用符やバックスラッシュが含まれていてもシェルエスケープなしで渡されること', async () => {
    const review = makeReview(1);
    // Inject special chars into a finding message — this appears verbatim in the
    // generated markdown, confirming no manual shell-quoting is applied.
    review.findings[0].message = 'It\'s a "test" with \\backslash';

    await postReviewToPR('/repo', 1, review);

    const body = ghClientCalls[0]?.body ?? '';
    // The body should contain the literal characters, not escaped versions.
    expect(body).toContain('"test"');
    expect(body).toContain('\\backslash');
  });
});
