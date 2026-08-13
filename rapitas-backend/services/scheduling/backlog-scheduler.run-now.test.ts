/**
 * backlog-scheduler run-now tests — manual-run completion notifications,
 * lastRunAt persistence, and the scheduled-path opt-out.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockListSchedules = mock(() => Promise.resolve([] as unknown[]));
const mockMarkScheduleRun = mock(() => Promise.resolve());
const mockEnsureSchedulesSeeded = mock(() => Promise.resolve());
const mockUpdateSchedule = mock(() => Promise.resolve());
const mockRunInnovationSession = mock(() => Promise.resolve(0));
const mockRunVulnerabilityScan = mock(() => Promise.resolve(0));
const mockRunLogHealthCheck = mock(() => Promise.resolve(0));
const mockRunLoopReview = mock(() => Promise.resolve(0));
const mockRunCiWatch = mock(() => Promise.resolve(0));
const mockCreateNotification = mock(() => Promise.resolve({ id: 1 }));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
// NOTE: bun's mock.module replaces the whole module — every runtime export must
// be mirrored or the missing ones become undefined at import time.
mock.module('./backlog-schedule-service', () => ({
  BACKLOG_JOB_KINDS: ['innovation', 'vuln_scan', 'health_check', 'loop_review', 'ci_watch'],
  normalizeJobKind: (v: unknown) => v,
  ensureSchedulesSeeded: mockEnsureSchedulesSeeded,
  listSchedules: mockListSchedules,
  updateSchedule: mockUpdateSchedule,
  markScheduleRun: mockMarkScheduleRun,
}));
mock.module('../memory/innovation-session', () => ({
  runInnovationSession: mockRunInnovationSession,
}));
mock.module('../memory/vulnerability-scan', () => ({
  runVulnerabilityScan: mockRunVulnerabilityScan,
}));
mock.module('../system/log-health-check', () => ({
  runLogHealthCheck: mockRunLogHealthCheck,
}));
mock.module('../self-improvement/loop-watcher', () => ({
  runLoopReview: mockRunLoopReview,
}));
mock.module('../self-improvement/ci-green-keeper', () => ({
  runCiWatch: mockRunCiWatch,
}));
mock.module('../communication/notification-service', () => ({
  createNotification: mockCreateNotification,
}));

const { runBacklogJobNow } = await import('./backlog-scheduler');

interface NotificationArg {
  type: string;
  title: string;
  message: string;
  link: string;
  metadata: Record<string, unknown>;
}

function lastNotification(): NotificationArg {
  const calls = mockCreateNotification.mock.calls;
  return calls[calls.length - 1]![0] as unknown as NotificationArg;
}

beforeEach(() => {
  mockMarkScheduleRun.mockReset();
  mockCreateNotification.mockReset();
  mockRunCiWatch.mockReset();
  mockRunInnovationSession.mockReset();
  mockMarkScheduleRun.mockResolvedValue(undefined);
  mockCreateNotification.mockResolvedValue({ id: 1 });
  mockRunCiWatch.mockResolvedValue(0);
  mockRunInnovationSession.mockResolvedValue(0);
});

describe('runBacklogJobNow (manual)', () => {
  test('成功時: lastRunAt を更新し、種別ラベルと生成件数を含む通知を作成する', async () => {
    mockRunCiWatch.mockResolvedValue(3);
    const count = await runBacklogJobNow('ci_watch');
    expect(count).toBe(3);
    expect(mockMarkScheduleRun).toHaveBeenCalledTimes(1);
    expect((mockMarkScheduleRun.mock.calls[0] as unknown[])[0]).toBe('ci_watch');
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const call = lastNotification();
    expect(call.type).toBe('system');
    expect(call.title).toBe('CI 監視（本線）が完了しました');
    expect(call.message).toBe('生成件数: 3 件');
    expect(call.link).toBe('/backlog/settings');
    expect(call.metadata).toEqual({
      kind: 'ci_watch',
      source: 'run_now',
      outcome: 'success',
      count: 3,
    });
  });

  test('失敗時: 例外を再スローしつつ、lastRunAt 更新と失敗通知を行う', async () => {
    mockRunCiWatch.mockRejectedValue(new Error('GitHub API rate limited'));
    await expect(runBacklogJobNow('ci_watch')).rejects.toThrow('GitHub API rate limited');
    expect(mockMarkScheduleRun).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const call = lastNotification();
    expect(call.type).toBe('system');
    expect(call.title).toBe('CI 監視（本線）に失敗しました');
    expect(call.message).toBe('GitHub API rate limited');
    expect(call.metadata.outcome).toBe('failure');
  });

  test('失敗時: 300字を超えるエラーメッセージは 300字+… に切り詰める', async () => {
    mockRunCiWatch.mockRejectedValue(new Error('x'.repeat(400)));
    await expect(runBacklogJobNow('ci_watch')).rejects.toThrow();
    const call = lastNotification();
    expect(call.message).toBe(`${'x'.repeat(300)}…`);
    expect(call.metadata.error).toBe(`${'x'.repeat(300)}…`);
  });

  test('実行中スキップ: 2回目の呼び出しは 0 を返し、スキップ通知のみで lastRunAt は更新しない', async () => {
    let resolveJob: (n: number) => void = () => {};
    mockRunInnovationSession.mockReturnValue(
      new Promise<number>((resolve) => {
        resolveJob = resolve;
      }),
    );
    const first = runBacklogJobNow('innovation');
    const second = await runBacklogJobNow('innovation');
    expect(second).toBe(0);
    // At this point only the skip notification exists — the first run is still in flight.
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    const skipCall = lastNotification();
    expect(skipCall.title).toBe('イノベーションセッションはスキップされました');
    expect(skipCall.message).toBe('既に実行中のため今回は開始されませんでした');
    expect(skipCall.metadata).toEqual({
      kind: 'innovation',
      source: 'run_now',
      outcome: 'skipped',
    });
    expect(mockMarkScheduleRun).not.toHaveBeenCalled();

    resolveJob(2);
    await expect(first).resolves.toBe(2);
    // The first (real) run then records its own success normally.
    expect(mockMarkScheduleRun).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledTimes(2);
    expect(lastNotification().metadata.outcome).toBe('success');
  });

  test('通知作成の失敗はジョブの成功結果に影響しない', async () => {
    mockRunCiWatch.mockResolvedValue(1);
    mockCreateNotification.mockRejectedValue(new Error('db down'));
    await expect(runBacklogJobNow('ci_watch')).resolves.toBe(1);
  });
});

describe('runBacklogJobNow (scheduled)', () => {
  test('成功しても通知・lastRunAt 更新を行わない（定期経路は tick 側が claim 済み）', async () => {
    mockRunCiWatch.mockResolvedValue(5);
    const count = await runBacklogJobNow('ci_watch', undefined, { source: 'scheduled' });
    expect(count).toBe(5);
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockMarkScheduleRun).not.toHaveBeenCalled();
  });

  test('失敗しても通知せず例外をそのまま伝播する', async () => {
    mockRunCiWatch.mockRejectedValue(new Error('boom'));
    await expect(runBacklogJobNow('ci_watch', undefined, { source: 'scheduled' })).rejects.toThrow(
      'boom',
    );
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockMarkScheduleRun).not.toHaveBeenCalled();
  });
});
