/**
 * daily-report-service.test-support
 *
 * Mocked prisma, notification and aux-AI collaborators shared by the
 * daily-report-service tests. Import it before anything that loads the service.
 * Contains no tests.
 */
import { mock } from 'bun:test';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// Point the cycle-log reader at a scratch dir so tests never touch ~/.rapitas.
// mkdtempSync: a pid-named directory is predictable and is reused once the OS
// recycles the pid, so two runs could share this data dir.
export const SCRATCH_DATA_DIR = mkdtempSync(join(tmpdir(), 'rapitas-daily-report-test-'));
process.env.RAPITAS_DATA_DIR = SCRATCH_DATA_DIR;

// ---------------------------------------------------------------------------
// Mocks (must be installed before importing the service under test)
// ---------------------------------------------------------------------------

export const notificationFindFirst = mock(() => Promise.resolve(null as unknown));
const notificationCount = mock(() => Promise.resolve(0));
export const taskFindMany = mock(() => Promise.resolve([] as unknown[]));
const prFindMany = mock(() => Promise.resolve([] as unknown[]));
const knowledgeFindMany = mock(() => Promise.resolve([] as unknown[]));
const decisionFindMany = mock(() => Promise.resolve([] as unknown[]));
const themeAutoRunFindMany = mock(() => Promise.resolve([] as unknown[]));
const transitionFindMany = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../config/database', () => ({
  prisma: {
    notification: { findFirst: notificationFindFirst, count: notificationCount },
    task: { findMany: taskFindMany },
    gitHubPullRequest: { findMany: prFindMany },
    knowledgeEntry: { findMany: knowledgeFindMany },
    decisionLog: { findMany: decisionFindMany },
    themeAutoRun: { findMany: themeAutoRunFindMany },
    workflowTransition: { findMany: transitionFindMany },
  },
}));

export const createNotificationMock = mock((params: Record<string, unknown>) =>
  Promise.resolve({ id: 1, ...params }),
);
mock.module('../communication/notification-service', () => ({
  createNotification: createNotificationMock,
}));

// getAuxAiMode/callClaudeCli drive callClaudeForReview (weekly-review-service),
// which aiFormatDailyReport delegates to. 'off' → throw → fail-open path.
let auxMode: 'cli' | 'api' | 'off' = 'off';
/** Choose how the aux AI behaves for the next call. */
export function setAuxMode(mode: 'cli' | 'api' | 'off'): void {
  auxMode = mode;
}
export const callClaudeCliMock = mock(() => Promise.resolve({ content: 'AI整形済みレポート' }));
mock.module('../../utils/ai-client', () => ({
  getAuxAiMode: () => auxMode,
  callClaudeCli: callClaudeCliMock,
  getApiKeyForProvider: () => Promise.resolve(null),
}));

export const {
  buildDailyReportData,
  formatDailyReport,
  formatDailyReportSummary,
  countCycleLogRestarts,
  dailyReportTitle,
  localDateStamp,
  runDailyReport,
} = await import('./daily-report-service');
export type DailyReportRawT = import('./daily-report-core').DailyReportRaw;

export const NOW = new Date(2026, 7, 13, 7, 0, 0); // 2026-08-13 07:00 local

/** Fixture builder: an all-zero raw payload, overridable per test. */
export function makeRaw(over: Partial<DailyReportRawT> = {}): DailyReportRawT {
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

/** Restore every mock to its empty-day default. */
export function resetMocks(): void {
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
    transitionFindMany,
  ]) {
    m.mockReset();
    m.mockImplementation(() => Promise.resolve([]));
  }
  createNotificationMock.mockClear();
  callClaudeCliMock.mockClear();
  auxMode = 'off';
}
