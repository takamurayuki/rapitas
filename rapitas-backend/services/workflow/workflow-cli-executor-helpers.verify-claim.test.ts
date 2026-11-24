/**
 * workflow-cli-executor-helpers.verify-claim.test
 *
 * validateOutput hands a pre-fetched measurement to validateVerify, and the
 * epilogue helper validateOutputWithMeasured looks it up by task id first (F7).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { MeasuredVerification } from './verify-claim';

mock.module('../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const loadMeasuredVerification = mock(
  async (_taskId: number, _content: string): Promise<MeasuredVerification | undefined> => undefined,
);
mock.module('./verify-claim-loader', () => ({ loadMeasuredVerification }));

const { validateOutput, validateOutputWithMeasured } =
  await import('./workflow-cli-executor-helpers');

const SHA = 'a1b2c3d4e5f6';
const report = `# 検証レポート

## 検証結果サマリ
✅ 検証成功。全テスト通過。

## テスト結果
| 初回実行 | exit 1 → 修正 | 10件中9件が失敗（RED 確認） |

## チェックリスト
- ✅ 実装

\`\`\`json:verify-claim
{"version":1,"overall":"success","runId":"r1","sha":"${SHA}","tests":{"ran":true,"failed":0}}
\`\`\`
`;
const measured: MeasuredVerification = {
  job: {
    status: 'completed',
    ok: true,
    revision: SHA,
    checks: [{ name: 'test', ran: true, errorCount: 0 }],
  },
};

describe('validateOutput passes the measurement through', () => {
  test('accepts with the measured job, rejects without it', () => {
    expect(validateOutput('verify', report, undefined, measured).ok).toBe(true);
    const bare = validateOutput('verify', report);
    expect(bare.ok).toBe(false);
    expect(bare.summary).toContain('job-missing');
  });
});

describe('validateOutputWithMeasured', () => {
  beforeEach(() => loadMeasuredVerification.mockClear());

  test('looks the job up by task id and content for verify.md', async () => {
    loadMeasuredVerification.mockResolvedValueOnce(measured);
    const r = await validateOutputWithMeasured(42, 'verify', report);
    expect(loadMeasuredVerification).toHaveBeenCalledWith(42, report);
    expect(r.ok).toBe(true);
  });

  test('does not look anything up for other artifacts', async () => {
    await validateOutputWithMeasured(42, 'plan', '# x');
    expect(loadMeasuredVerification).not.toHaveBeenCalled();
  });
});
