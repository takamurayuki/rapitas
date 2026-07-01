/**
 * auto-merge-exhaustion テスト
 *
 * 上限到達候補のパーク（auto_merge_exhausted）と head コミット変化による自動復帰:
 * merged系は恒久skip、exhaustedはhead不変でskip・head変化で復帰、
 * 終端マークなしでもblock累計がエスケープバルブ上限に達したらパークすること。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
// NOTE: bun's mock.module is process-global — mirror ALL real exports so other
// test files importing evaluateAutoMergeChecks etc. from this module still work.
import * as realChecks from '../../services/workflow/auto-merge-checks';

const mockPrisma = {
  workflowTransition: {
    findFirst: mock(() => Promise.resolve(null as unknown)),
    count: mock(() => Promise.resolve(0)),
  },
};
const recordTransition = mock(() => Promise.resolve());
const readHeadSha = mock(() => Promise.resolve<string | null>('sha-current'));

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('../../services/workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../../services/workflow/auto-merge-checks', () => ({ ...realChecks, readHeadSha }));

const { decideTerminalState, markExhausted, resetExhaustedRecheckCooldowns, EXHAUSTED_CAUSE } =
  await import('../../services/workflow/auto-merge-exhaustion');

function exhaustedRow(headSha: string | null) {
  return { cause: EXHAUSTED_CAUSE, metadata: JSON.stringify({ reason: 'r', headSha }) };
}

describe('decideTerminalState', () => {
  beforeEach(() => {
    resetExhaustedRecheckCooldowns();
    mockPrisma.workflowTransition.findFirst.mockReset().mockResolvedValue(null);
    mockPrisma.workflowTransition.count.mockReset().mockResolvedValue(0);
    recordTransition.mockReset().mockResolvedValue(undefined);
    readHeadSha.mockReset().mockResolvedValue('sha-current');
  });

  test('終端マークなし・block少 → 続行（skip:false）', async () => {
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d.skip).toBe(false);
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('auto_merged → 恒久skip（headは見ない）', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      cause: 'auto_merged',
      metadata: '{}',
    });
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d).toEqual({ skip: true, kind: 'merged' });
    expect(readHeadSha).not.toHaveBeenCalled();
  });

  test('exhausted + head不変 → skip（パーク継続）', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue(exhaustedRow('sha-current'));
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d).toEqual({ skip: true, kind: 'exhausted' });
  });

  test('exhausted + head変化 → 復帰（skip:false, resumed）', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue(exhaustedRow('sha-old'));
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d.skip).toBe(false);
    expect(d.kind).toBe('resumed');
  });

  test('exhausted + head読取不能（null） → skip（検証不能はパーク維持）', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue(exhaustedRow('sha-old'));
    readHeadSha.mockResolvedValue(null);
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d).toEqual({ skip: true, kind: 'exhausted' });
  });

  test('recheckクールダウン内の2回目はghを呼ばずskip', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue(exhaustedRow('sha-current'));
    await decideTerminalState(1, 100, '/repo');
    const callsAfterFirst = readHeadSha.mock.calls.length;
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d).toEqual({ skip: true, kind: 'exhausted' });
    expect(readHeadSha.mock.calls.length).toBe(callsAfterFirst); // no extra gh call
  });

  test('エスケープバルブ: block累計が上限以上 → その場でパーク（exhausted_now）', async () => {
    mockPrisma.workflowTransition.count.mockResolvedValue(12); // default RAPITAS_AUTOMERGE_MAX_TOTAL_BLOCKS
    const d = await decideTerminalState(1, 100, '/repo');
    expect(d.skip).toBe(true);
    expect(d.kind).toBe('exhausted_now');
    const rt = recordTransition.mock.calls[0][0] as { cause: string };
    expect(rt.cause).toBe(EXHAUSTED_CAUSE);
  });
});

describe('markExhausted', () => {
  beforeEach(() => {
    recordTransition.mockReset().mockResolvedValue(undefined);
    readHeadSha.mockReset().mockResolvedValue('sha-current');
  });

  test('現在のhead SHAをmetadataに記録すること（後の変化検出の基準点）', async () => {
    await markExhausted(5, 200, '/repo', 'ci failed (repairs exhausted)');
    const rt = recordTransition.mock.calls[0][0] as {
      cause: string;
      metadata: { headSha: string | null; reason: string };
    };
    expect(rt.cause).toBe(EXHAUSTED_CAUSE);
    expect(rt.metadata.headSha).toBe('sha-current');
    expect(rt.metadata.reason).toContain('repairs exhausted');
  });
});
