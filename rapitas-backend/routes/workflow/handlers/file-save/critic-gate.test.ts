/**
 * critic-gate テスト
 *
 * 2026-10-31 の調査で「research/plan critic が走ったのか」に答えられないことが
 * 分かった。ゲートが記録するのは失敗だけである — 差し戻しは
 * `<phase>_critic_failed` 遷移、タイムアウトとエラーは warn。通過は
 * phase-critic.ts の `log.info` 1行で、config/logger.ts のファイルシンクは
 * warn 以上しか永続化しない。つまり**通過したゲートと一度も走らなかったゲートが
 * ディスク上で同じ見え方になり**、criticFirstPass はどちらでも null を返す。
 *
 * ここで固定するのは、判定されずに保存された research/plan が必ず痕跡を残すこと
 * と、その理由（lightweight か、status が前進していないか）が区別できること。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const warnings: Array<{ fields: Record<string, unknown>; msg: string }> = [];
mock.module('../../../../config/logger', () => {
  const logger = {
    info() {},
    debug() {},
    fatal() {},
    error() {},
    warn(fields: Record<string, unknown>, msg: string) {
      warnings.push({ fields, msg });
    },
  };
  return { createLogger: () => logger, logger, getBackendLogFilePath: () => '/tmp/b.log' };
});

const applyPhaseCriticGate = mock(async () => ({ bounced: false }) as Record<string, unknown>);
mock.module('../../../../services/workflow/phase-critic', () => ({ applyPhaseCriticGate }));

const { runPhaseCriticGate } = await import('./critic-gate');

/** The one warn this file adds, if it fired. */
const skipWarning = () =>
  warnings.find((w) => w.msg.includes('saved without being judged'))?.fields;

beforeEach(() => {
  warnings.length = 0;
  applyPhaseCriticGate.mockClear();
});

describe('the gate runs when it should', () => {
  test.each([
    ['research', 'research_done'],
    ['plan', 'plan_created'],
  ] as const)('judges a %s save that advanced the status', async (fileType, newStatus) => {
    await runPhaseCriticGate({
      taskId: 1,
      fileType,
      newStatus,
      savedContent: '# artifact',
      workflowMode: 'standard',
    });

    expect(applyPhaseCriticGate).toHaveBeenCalledTimes(1);
    // Nothing was bypassed, so there is nothing to report.
    expect(skipWarning()).toBeUndefined();
  });
});

describe('an artifact that bypassed the gate leaves a trace', () => {
  // `newStatus` is set only by the save that ADVANCES the status
  // (status-transition.ts), and the `file_saved:<type>` transition that
  // criticFirstPass counts lives behind the same condition. So this is the
  // case where both the gate and its metric go quiet together.
  test('says so when the status did not advance', async () => {
    await runPhaseCriticGate({
      taskId: 7,
      fileType: 'research',
      newStatus: undefined,
      savedContent: '# artifact',
      workflowMode: 'standard',
    });

    expect(applyPhaseCriticGate).not.toHaveBeenCalled();
    expect(skipWarning()).toEqual({
      taskId: 7,
      fileType: 'research',
      newStatus: null,
      workflowMode: 'standard',
      reason: 'status_not_advanced',
    });
  });

  // Lightweight is a deliberate skip, not a defect — but it still has to be
  // distinguishable from the one above, or the trace answers nothing.
  test('names lightweight mode as a different reason', async () => {
    await runPhaseCriticGate({
      taskId: 8,
      fileType: 'plan',
      newStatus: 'plan_created',
      savedContent: '# plan',
      workflowMode: 'lightweight',
    });

    expect(applyPhaseCriticGate).not.toHaveBeenCalled();
    expect(skipWarning()?.reason).toBe('lightweight_mode');
  });

  // It has to be warn: config/logger.ts persists warn and above to the daily
  // file, and an info line would vanish exactly like the pass it replaces.
  test('reports it at a level the daily log file keeps', async () => {
    await runPhaseCriticGate({
      taskId: 9,
      fileType: 'research',
      newStatus: undefined,
      savedContent: '# artifact',
      workflowMode: 'standard',
    });

    expect(warnings.some((w) => w.msg.includes('saved without being judged'))).toBe(true);
  });
});

describe('other artifacts are not this gate’s business', () => {
  test.each(['verify', 'question'] as const)('stays silent on a %s save', async (fileType) => {
    await runPhaseCriticGate({
      taskId: 2,
      fileType,
      newStatus: 'completed',
      savedContent: '# other',
      workflowMode: 'standard',
    });

    expect(applyPhaseCriticGate).not.toHaveBeenCalled();
    // A verify save skipping the research/plan critic is not a skip at all,
    // and warning about it every time would bury the case that matters.
    expect(skipWarning()).toBeUndefined();
  });
});
