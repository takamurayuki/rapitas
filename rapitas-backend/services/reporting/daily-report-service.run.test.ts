/**
 * daily-report-service.run.test
 *
 * runDailyReport: idempotency, the AI fail-open path and the empty-day shortcut.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  notificationFindFirst,
  taskFindMany,
  createNotificationMock,
  callClaudeCliMock,
  setAuxMode,
  resetMocks,
  runDailyReport,
  dailyReportTitle,
  localDateStamp,
} from './daily-report-service.test-support';

beforeEach(resetMocks);

// ---------------------------------------------------------------------------
// runDailyReport — idempotency + AI fail-open
// ---------------------------------------------------------------------------

describe('runDailyReport', () => {
  it('is idempotent: returns 0 and creates nothing when today already exists', async () => {
    notificationFindFirst.mockImplementation(() => Promise.resolve({ id: 99 }));
    expect(await runDailyReport()).toBe(0);
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('fail-open: AI unavailable still creates ONE plain-table notification', async () => {
    setAuxMode('off'); // callClaudeForReview throws
    taskFindMany.mockImplementation((args: unknown) => {
      // First task query is the completed-task window; second is the queue.
      const where = (args as { where: { status: unknown } }).where;
      if (typeof where.status === 'object' && where.status !== null) {
        return Promise.resolve([{ id: 1, title: '完了済みタスク', completedAt: new Date() }]);
      }
      return Promise.resolve([]);
    });
    expect(await runDailyReport()).toBe(1);
    expect(createNotificationMock).toHaveBeenCalledTimes(1);
    const params = createNotificationMock.mock.calls[0]![0] as {
      type: string;
      title: string;
      link: string;
      metadata: { aiFormatted: boolean; reportMarkdown: string; counts: { completed: number } };
    };
    expect(params.type).toBe('daily_report');
    expect(params.title).toBe(dailyReportTitle(localDateStamp(new Date())));
    expect(params.link).toBe('/agents/daily-report');
    expect(params.metadata.aiFormatted).toBe(false);
    expect(params.metadata.reportMarkdown).toContain('## 完了タスク (1件)');
    expect(params.metadata.counts.completed).toBe(1);
  });

  it('AI success: uses the polished markdown and marks aiFormatted=true', async () => {
    setAuxMode('cli');
    taskFindMany.mockImplementation((args: unknown) => {
      const where = (args as { where: { status: unknown } }).where;
      if (typeof where.status === 'object' && where.status !== null) {
        return Promise.resolve([{ id: 1, title: '完了済みタスク', completedAt: new Date() }]);
      }
      return Promise.resolve([]);
    });
    expect(await runDailyReport()).toBe(1);
    const params = createNotificationMock.mock.calls[0]![0] as {
      metadata: { aiFormatted: boolean; reportMarkdown: string };
    };
    expect(params.metadata.aiFormatted).toBe(true);
    expect(params.metadata.reportMarkdown.startsWith('AI整形済みレポート')).toBe(true);
    expect(params.metadata.reportMarkdown).toContain('## 計画の点検（入力の切り詰め）');
  });

  it('empty day: skips the AI call entirely and ships the plain fallback', async () => {
    setAuxMode('cli');
    expect(await runDailyReport()).toBe(1);
    expect(callClaudeCliMock).not.toHaveBeenCalled();
    const params = createNotificationMock.mock.calls[0]![0] as {
      metadata: { aiFormatted: boolean };
    };
    expect(params.metadata.aiFormatted).toBe(false);
  });
});
