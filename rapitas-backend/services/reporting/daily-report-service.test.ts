/**
 * daily-report-service.test
 *
 * Unit tests for the daily-report aggregation core (empty / intervention /
 * satiated / normal-day fixtures), the plain formatting fallback, the AI
 * fail-open path, idempotency, and the cycle-log restart counter. prisma and
 * the aux-AI client are mocked; the pure core needs no mocks at all.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

// Point the cycle-log reader at a scratch dir so tests never touch ~/.rapitas.
const SCRATCH_DATA_DIR = join(tmpdir(), `rapitas-daily-report-test-${process.pid}`);
process.env.RAPITAS_DATA_DIR = SCRATCH_DATA_DIR;

// ---------------------------------------------------------------------------
// Mocks (must be installed before importing the service under test)
// ---------------------------------------------------------------------------

const notificationFindFirst = mock(() => Promise.resolve(null as unknown));
const notificationCount = mock(() => Promise.resolve(0));
const taskFindMany = mock(() => Promise.resolve([] as unknown[]));
const prFindMany = mock(() => Promise.resolve([] as unknown[]));
const knowledgeFindMany = mock(() => Promise.resolve([] as unknown[]));
const decisionFindMany = mock(() => Promise.resolve([] as unknown[]));
const themeAutoRunFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../config/database', () => ({
  prisma: {
    notification: { findFirst: notificationFindFirst, count: notificationCount },
    task: { findMany: taskFindMany },
    gitHubPullRequest: { findMany: prFindMany },
    knowledgeEntry: { findMany: knowledgeFindMany },
    decisionLog: { findMany: decisionFindMany },
    themeAutoRun: { findMany: themeAutoRunFindMany },
  },
}));

const createNotificationMock = mock((params: Record<string, unknown>) =>
  Promise.resolve({ id: 1, ...params }),
);
mock.module('../communication/notification-service', () => ({
  createNotification: createNotificationMock,
}));

// getAuxAiMode/callClaudeCli drive callClaudeForReview (weekly-review-service),
// which aiFormatDailyReport delegates to. 'off' → throw → fail-open path.
let auxMode: 'cli' | 'api' | 'off' = 'off';
const callClaudeCliMock = mock(() => Promise.resolve({ content: 'AI整形済みレポート' }));
mock.module('../../utils/ai-client', () => ({
  getAuxAiMode: () => auxMode,
  callClaudeCli: callClaudeCliMock,
  getApiKeyForProvider: () => Promise.resolve(null),
}));

const {
  buildDailyReportData,
  formatDailyReport,
  formatDailyReportSummary,
  countCycleLogRestarts,
  dailyReportTitle,
  localDateStamp,
  runDailyReport,
} = await import('./daily-report-service');
type DailyReportRawT = import('./daily-report-core').DailyReportRaw;

const NOW = new Date(2026, 7, 13, 7, 0, 0); // 2026-08-13 07:00 local

/** Fixture builder: an all-zero raw payload, overridable per test. */
function makeRaw(over: Partial<DailyReportRawT> = {}): DailyReportRawT {
  return {
    tasks: [],
    prs: [],
    concerns: [],
    decisions: [],
    restarts: { fromCycleLog: 0, fromNotifications: 0 },
    themes: [],
    queueCandidates: [],
    ...over,
  };
}

beforeEach(() => {
  notificationFindFirst.mockReset();
  notificationFindFirst.mockImplementation(() => Promise.resolve(null));
  notificationCount.mockReset();
  notificationCount.mockImplementation(() => Promise.resolve(0));
  for (const m of [
    taskFindMany,
    prFindMany,
    knowledgeFindMany,
    decisionFindMany,
    themeAutoRunFindMany,
  ]) {
    m.mockReset();
    m.mockImplementation(() => Promise.resolve([]));
  }
  createNotificationMock.mockClear();
  callClaudeCliMock.mockClear();
  auxMode = 'off';
});

// ---------------------------------------------------------------------------
// buildDailyReportData — pure core fixtures
// ---------------------------------------------------------------------------

describe('buildDailyReportData', () => {
  it('empty day: every count is zero, empty=true, not satiated without armed themes', () => {
    const data = buildDailyReportData(makeRaw(), NOW);
    expect(data.empty).toBe(true);
    expect(data.satiated).toBe(false);
    expect(data.completedTasks).toHaveLength(0);
    expect(data.concerns.total).toBe(0);
    expect(data.restartCount).toBe(0);
    expect(data.humanIntervention).toEqual({ occurred: false, count: 0 });
    expect(data.date).toBe('2026-08-13');
  });

  it('intervention day: decidedBy:user decisions are counted as human intervention', () => {
    const data = buildDailyReportData(
      makeRaw({
        decisions: [
          {
            id: 1,
            decision: '[plan承認] タスクA',
            rationale: '妥当',
            context: 'タスク#1 のplan承認ゲート [decidedBy:user]',
            predictedOutcome: '完了する',
            confidence: 0.75,
          },
          {
            id: 2,
            decision: '[plan承認] タスクB',
            rationale: null,
            context: 'タスク#2 のplan承認ゲート [decidedBy:auto]',
            predictedOutcome: '完了する',
            confidence: 0.6,
          },
        ],
      }),
      NOW,
    );
    expect(data.humanIntervention).toEqual({ occurred: true, count: 1 });
    expect(data.decisions.map((d) => d.actor)).toEqual(['user', 'auto']);
    expect(data.empty).toBe(false);
  });

  it('satiated day: 0 completions + an armed-idle theme sets satiated with a reason', () => {
    const data = buildDailyReportData(
      makeRaw({
        themes: [
          { themeId: 1, enabled: true, status: 'idle' },
          { themeId: 2, enabled: false, status: 'idle' },
        ],
      }),
      NOW,
    );
    expect(data.satiated).toBe(true);
    expect(data.satiatedReason).toContain('armed-idle');
    expect(data.satiatedReason).toContain('1 件');
  });

  it('a running theme or a completion clears satiation', () => {
    const running = buildDailyReportData(
      makeRaw({ themes: [{ themeId: 1, enabled: true, status: 'running' }] }),
      NOW,
    );
    expect(running.satiated).toBe(false);
    const completedDay = buildDailyReportData(
      makeRaw({
        tasks: [{ id: 5, title: 'T', completedAt: NOW, prNumber: null }],
        themes: [{ themeId: 1, enabled: true, status: 'idle' }],
      }),
      NOW,
    );
    expect(completedDay.satiated).toBe(false);
  });

  it('normal day: aggregates counts, concern sources, learnings, PR numbers and queue', () => {
    const data = buildDailyReportData(
      makeRaw({
        tasks: [
          { id: 10, title: '機能A', completedAt: NOW, prNumber: 123 },
          { id: 11, title: '機能B', completedAt: NOW, prNumber: null },
        ],
        prs: [{ prNumber: 123, title: 'feat: A', url: 'https://example.com/123' }],
        concerns: [
          { id: 1, title: '懸念1', tags: '["severity:medium","source:loop_review"]' },
          { id: 2, title: '回顧の学び', tags: '["severity:low","source:process_retro"]' },
          {
            id: 3,
            title: 'インシデントの学び',
            tags: '["severity:high","source:self_incident_watch"]',
          },
          { id: 4, title: '壊れたタグ', tags: 'not-json' },
        ],
        restarts: { fromCycleLog: 1, fromNotifications: 2 },
        queueCandidates: [
          { id: 21, title: '低優先', priority: 'low', createdAt: new Date(2026, 7, 1) },
          { id: 22, title: '至急', priority: 'urgent', createdAt: new Date(2026, 7, 3) },
          { id: 23, title: '中1', priority: null, createdAt: new Date(2026, 7, 2) },
          { id: 24, title: '中2', priority: 'medium', createdAt: new Date(2026, 7, 1) },
        ],
      }),
      NOW,
    );
    expect(data.completedTasks[0]).toEqual({ id: 10, title: '機能A', prNumber: 123 });
    expect(data.mergedPrs.approximate).toBe(true);
    expect(data.concerns.total).toBe(4);
    expect(data.concerns.bySource).toEqual({
      loop_review: 1,
      process_retro: 1,
      self_incident_watch: 1,
      unknown: 1,
    });
    expect(data.learnings.retro).toEqual(['回顧の学び']);
    expect(data.learnings.incident).toEqual(['インシデントの学び']);
    expect(data.restartCount).toBe(3);
    // Queue preview: urgent first, then medium ties broken by createdAt asc.
    expect(data.upcomingQueue.map((t) => t.id)).toEqual([22, 24, 23]);
    expect(data.empty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatDailyReport / summary — fail-open output
// ---------------------------------------------------------------------------

describe('formatDailyReport', () => {
  it('renders every section heading with exact counts and never throws on zero data', () => {
    const md = formatDailyReport(buildDailyReportData(makeRaw(), NOW));
    expect(md).toContain('# デイリーレポート 2026-08-13');
    expect(md).toContain('## サマリ');
    expect(md).toContain('## 完了タスク (0件)');
    expect(md).toContain('## マージ済みPR (0件・近似)');
    expect(md).toContain('## 起票された懸念 (0件)');
    expect(md).toContain('## 意思決定 (0件)');
    expect(md).toContain('## 自己再起動');
    expect(md).toContain('## 次に着手予定のキュー先頭3件（プレビュー）');
    expect(md).not.toContain('## 静止していた理由');
  });

  it('includes the satiation reason section on satiated days', () => {
    const md = formatDailyReport(
      buildDailyReportData(
        makeRaw({ themes: [{ themeId: 1, enabled: true, status: 'idle' }] }),
        NOW,
      ),
    );
    expect(md).toContain('## 静止していた理由');
    expect(md).toContain('armed-idle');
  });

  it('summary line carries the counts and the satiation flag', () => {
    const summary = formatDailyReportSummary(
      buildDailyReportData(
        makeRaw({ themes: [{ themeId: 1, enabled: true, status: 'idle' }] }),
        NOW,
      ),
    );
    expect(summary).toContain('2026-08-13');
    expect(summary).toContain('完了0件');
    expect(summary).toContain('人間介入なし');
    expect(summary).toContain('飽和静止');
  });
});

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
    auxMode = 'off'; // callClaudeForReview throws
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
    expect(params.link).toBe('/agents/growth');
    expect(params.metadata.aiFormatted).toBe(false);
    expect(params.metadata.reportMarkdown).toContain('## 完了タスク (1件)');
    expect(params.metadata.counts.completed).toBe(1);
  });

  it('AI success: uses the polished markdown and marks aiFormatted=true', async () => {
    auxMode = 'cli';
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
    expect(params.metadata.reportMarkdown).toBe('AI整形済みレポート');
  });

  it('empty day: skips the AI call entirely and ships the plain fallback', async () => {
    auxMode = 'cli';
    expect(await runDailyReport()).toBe(1);
    expect(callClaudeCliMock).not.toHaveBeenCalled();
    const params = createNotificationMock.mock.calls[0]![0] as {
      metadata: { aiFormatted: boolean };
    };
    expect(params.metadata.aiFormatted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// countCycleLogRestarts — NDJSON window counting
// ---------------------------------------------------------------------------

describe('countCycleLogRestarts', () => {
  it('returns 0 when the day files are missing (best-effort)', async () => {
    const now = new Date();
    expect(await countCycleLogRestarts(new Date(now.getTime() - 1000), now)).toBe(0);
  });

  it('counts only restart.triggered events inside the window across day files', async () => {
    const logsDir = join(SCRATCH_DATA_DIR, 'logs');
    mkdirSync(logsDir, { recursive: true });
    const now = new Date();
    const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const inWindow = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const outOfWindow = new Date(now.getTime() - 30 * 60 * 60 * 1000).toISOString();
    const stamp = localDateStamp(now);
    try {
      writeFileSync(
        join(logsDir, `cycle-${stamp}.ndjson`),
        [
          JSON.stringify({ t: inWindow, evt: 'restart.triggered' }),
          JSON.stringify({ t: outOfWindow, evt: 'restart.triggered' }),
          JSON.stringify({ t: inWindow, evt: 'task.completed' }),
          'broken-line{',
          '',
        ].join('\n'),
      );
      expect(await countCycleLogRestarts(windowStart, now)).toBe(1);
    } finally {
      rmSync(SCRATCH_DATA_DIR, { recursive: true, force: true });
    }
  });
});
