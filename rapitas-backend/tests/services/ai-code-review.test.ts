/**
 * AICodeReview テスト
 *
 * reviewBranchDiff / postReviewToPR のユニットテスト。
 * findings 0件・security/performance検出・plan_compliance・test_coverage・dedup・riskLevel算出・PR投稿を網羅する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// --- mocks (宣言は import より前に置く必要がある) ---
const mockExecFileAsync = mock(() => Promise.resolve({ stdout: '', stderr: '' }));

mock.module('child_process', () => ({
  execFile: () => {},
}));

mock.module('util', () => ({
  promisify: () => mockExecFileAsync,
}));

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { reviewBranchDiff, postReviewToPR } = await import('../../services/ai/ai-code-review');

describe('reviewBranchDiff', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  test('空diffでfindings 0件・riskLevel low を返す', async () => {
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main');

    expect(result.totalFindings).toBe(0);
    expect(result.riskLevel).toBe('low');
    expect(result.findings).toHaveLength(0);
  });

  test('eval() を含むdiffでsecurity critical / riskLevel high を検出する', async () => {
    const diff = '+++ b/src/utils.ts\n+ eval(userInput)\n';
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: diff, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/utils.ts\n', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main');

    const securityFinding = result.findings.find((f) => f.category === 'security');
    expect(securityFinding).toBeDefined();
    expect(securityFinding?.severity).toBe('critical');
    expect(result.riskLevel).toBe('high');
  });

  test('SELECT * を含むdiffでperformance warning を検出する', async () => {
    const diff = "+++ b/src/query.ts\n+ const rows = await db.query('SELECT * FROM users');\n";
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: diff, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/query.ts\n', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main');

    const perfFinding = result.findings.find((f) => f.category === 'performance');
    expect(perfFinding).toBeDefined();
    expect(perfFinding?.severity).toBe('warning');
  });

  test('planContent提供時にplan外ファイル変更でplan_compliance info を返す', async () => {
    const diff = '+++ b/src/unplanned.ts\n+ const x = 1;\n';
    const planContent = '## 変更ファイル\n- src/planned-file.ts';
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: diff, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/unplanned.ts\n', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main', planContent);

    const complianceFinding = result.findings.find((f) => f.category === 'plan_compliance');
    expect(complianceFinding).toBeDefined();
    expect(complianceFinding?.severity).toBe('info');
  });

  test('ソースのみ変更でテストなし時にtest_coverage warning を返す', async () => {
    const diff = '+++ b/src/service.ts\n+ const x = 1;\n';
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: diff, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/service.ts\n', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main');

    const coverageFinding = result.findings.find((f) => f.category === 'test_coverage');
    expect(coverageFinding).toBeDefined();
    expect(coverageFinding?.severity).toBe('warning');
  });

  test('同一file+messageの重複findingsが1件に集約される', async () => {
    const diff = '+++ b/src/utils.ts\n+ eval(a)\n+ eval(b)\n';
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: diff, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/utils.ts\n', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main');

    const evalFindings = result.findings.filter(
      (f) => f.category === 'security' && f.message.includes('eval'),
    );
    expect(evalFindings).toHaveLength(1);
  });

  test('warning 3件以上でriskLevel mediumを返す', async () => {
    const diff = [
      '+++ b/src/a.ts',
      "+ db.query('SELECT * FROM a')",
      '+++ b/src/b.ts',
      "+ db.query('SELECT * FROM b')",
      '+++ b/src/c.ts',
      "+ db.query('SELECT * FROM c')",
    ].join('\n');
    mockExecFileAsync
      .mockResolvedValueOnce({ stdout: diff, stderr: '' })
      .mockResolvedValueOnce({ stdout: 'src/a.ts\nsrc/b.ts\nsrc/c.ts\n', stderr: '' });

    const result = await reviewBranchDiff('/repo', 'main');

    expect(result.riskLevel).toBe('medium');
  });

  test('gitコマンド失敗時でもriskLevel lowで返す', async () => {
    mockExecFileAsync.mockRejectedValue(new Error('git not found'));

    const result = await reviewBranchDiff('/repo', 'main');

    expect(result.riskLevel).toBe('low');
    expect(result.totalFindings).toBe(0);
  });
});

describe('postReviewToPR', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  test('totalFindings 0件のとき execFileAsync を呼ばない（早期return）', async () => {
    const review = {
      riskLevel: 'low' as const,
      findings: [],
      summary: 'No findings',
      reviewedFiles: 5,
      totalFindings: 0,
    };

    await postReviewToPR('/repo', 1, review);

    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });

  test('findings 1件以上のとき execFileAsync を1回呼ぶ（PRコメント投稿）', async () => {
    mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' });

    const review = {
      riskLevel: 'high' as const,
      findings: [
        {
          file: 'src/utils.ts',
          severity: 'critical' as const,
          category: 'security' as const,
          message: 'eval() usage detected',
        },
      ],
      summary: '1 finding',
      reviewedFiles: 1,
      totalFindings: 1,
    };

    await postReviewToPR('/repo', 42, review);

    expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
  });
});
