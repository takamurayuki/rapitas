/**
 * daily-report-service — the self-verify miss section survives the AI polish (task 1602)
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { SelfVerifyMissSummary } from '../workflow/self-verify-miss';

let summary: SelfVerifyMissSummary | null = null;
const summarize = mock(async () => {
  if (!summary) throw new Error('ledger down');
  return summary;
});
// Mirrors every export of the barrel (bun replaces the whole module).
mock.module('../workflow/self-verify-miss', () => ({
  summarizeSelfVerifyMisses: summarize,
  listJudgmentMisses: async () => [],
  recordSelfVerifyMiss: async () => false,
  recordRepairMisses: async () => 0,
  findPassingJob: async () => null,
  classifyRepairMiss: () => [],
  kindOfGate: () => 'judgment',
  SELF_VERIFY_MISS_EVENT: 'self_verify_miss',
}));

const support = await import('./daily-report-service.test-support');
const { runDailyReport, resetMocks, setAuxMode, createNotificationMock, callClaudeCliMock } =
  support;

const oneMiss: SelfVerifyMissSummary = {
  passedRuns: 2,
  misses: 1,
  missedRuns: 1,
  rate: 0.5,
  byKind: [
    { key: 'mechanical', kind: 'mechanical', misses: 1, missedRuns: 1, rate: 0.5 },
    { key: 'judgment', kind: 'judgment', misses: 0, missedRuns: 0, rate: 0 },
  ],
  byGate: [{ key: 'ci:Lint Code', kind: 'mechanical', misses: 1, missedRuns: 1, rate: 0.5 }],
  candidates: [
    { gate: 'ci:Lint Code', status: 'partial', uncoveredSteps: ['Unused files'], misses: 1 },
  ],
};

const reportMarkdown = () => {
  const call = createNotificationMock.mock.calls[0]![0] as { metadata: { reportMarkdown: string } };
  return call.metadata.reportMarkdown;
};

beforeEach(() => {
  resetMocks();
  summarize.mockClear();
  summary = oneMiss;
});

describe('runDailyReport self-verify misses', () => {
  test('the numbers are appended after the AI-formatted body', async () => {
    setAuxMode('cli');
    expect(await runDailyReport()).toBe(1);
    expect(callClaudeCliMock).toHaveBeenCalled();
    const md = reportMarkdown();
    expect(md.startsWith('AI整形済みレポート')).toBe(true);
    expect(md).toContain('## 自己検証の見落とし');
    expect(md).toContain('50.0%（1/2）');
    expect(md).toContain('| ci:Lint Code | 一部だけ覆っている | Unused files |');
  });

  test('a day whose only activity is a miss is not an empty report', async () => {
    setAuxMode('cli');
    await runDailyReport();
    // Not empty → the AI polish ran (an empty day skips it).
    expect(callClaudeCliMock).toHaveBeenCalledTimes(1);
  });

  test('an unreadable ledger still ships the report with a note', async () => {
    summary = null;
    expect(await runDailyReport()).toBe(1);
    expect(reportMarkdown()).toContain('集計できませんでした');
  });
});
