/**
 * daily-report-critic.test
 *
 * The plan-critic truncation counts: the pure aggregation, and that they reach
 * the report body and notification metadata (task 1593).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';

// Point the cycle-log reader at a scratch dir so tests never touch ~/.rapitas.
process.env.RAPITAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'rapitas-daily-report-critic-'));

type Row = { cause: string; metadata: string | null };
const transitionFindMany = mock((_args: unknown) => Promise.resolve([] as Row[]));
const empty = () => Promise.resolve([] as unknown[]);

mock.module('../../config/database', () => ({
  prisma: {
    notification: { findFirst: () => Promise.resolve(null), count: () => Promise.resolve(0) },
    task: { findMany: empty },
    gitHubPullRequest: { findMany: empty },
    knowledgeEntry: { findMany: empty },
    decisionLog: { findMany: empty },
    themeAutoRun: { findMany: empty },
    workflowTransition: { findMany: transitionFindMany },
  },
}));
const createNotification = mock((_params: Record<string, unknown>) => Promise.resolve({ id: 1 }));
mock.module('../communication/notification-service', () => ({ createNotification }));
let aiReply = '';
mock.module('../ai/weekly-review-service', () => ({
  callClaudeForReview: () => Promise.resolve(aiReply),
}));
mock.module('./briefing/briefing-hook', () => ({ runBriefingHook: () => Promise.resolve() }));

const {
  summarizePlanCritic,
  formatPlanCriticSection,
  stripPlanCriticSection,
  PLAN_CRITIC_HEADING,
} = await import('./daily-report-critic');
const { runDailyReport, aiFormatDailyReport, buildDailyReportData } =
  await import('./daily-report-service');

const row = (cause: string, metadata: unknown): Row => ({
  cause,
  metadata: typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
});

const ROWS: Row[] = [
  row('plan_critic_incomplete', { downgradedByTruncation: true, reasons: ['a', 'b'] }),
  row('plan_critic_incomplete', { downgradedByTruncation: true, reasons: [] }),
  row('plan_critic_incomplete', { downgradedByTruncation: false, reasons: ['unavailable'] }),
  row('plan_critic_failed', { returnedFromTruncation: true, reasons: ['a', 'b'] }),
  row('plan_critic_failed', { returnedFromTruncation: false, reasons: ['c'] }),
  row('plan_critic_exhausted', { returnedFromTruncation: true, reasons: ['d'] }),
  row('plan_critic_failed', '{broken'),
  row('plan_critic_incomplete', 'null'),
  { cause: 'plan_critic_failed', metadata: null },
];

const COUNTS = {
  available: true,
  truncatedDowngrades: 2,
  downgradedWithReasons: 1,
  returned: 1,
  returnedReasons: 2,
  proceededExhausted: 1,
};
const ZERO = {
  available: true,
  truncatedDowngrades: 0,
  downgradedWithReasons: 0,
  returned: 0,
  returnedReasons: 0,
  proceededExhausted: 0,
};

const rawWith = (criticTransitions: Row[] | null) => ({
  tasks: [],
  prs: [],
  concerns: [],
  decisions: [],
  restarts: { fromCycleLog: 0, fromNotifications: 0 },
  themes: [],
  queueCandidates: [],
  criticTransitions,
});

const sentReport = () => {
  const params = createNotification.mock.calls[0]?.[0] as {
    metadata: { reportMarkdown: string; sections: { planCritic: unknown } };
  };
  return params.metadata;
};

beforeEach(() => {
  transitionFindMany.mockReset().mockResolvedValue([]);
  createNotification.mockClear();
  aiReply = '';
});

describe('summarizePlanCritic', () => {
  it('counts nothing for no rows', () => {
    expect(summarizePlanCritic([])).toEqual(ZERO);
    expect(summarizePlanCritic(undefined)).toEqual(ZERO);
  });

  it('counts truncation downgrades and returns, skipping broken metadata', () => {
    expect(summarizePlanCritic(ROWS)).toEqual(COUNTS);
  });

  it('keeps a failed lookup distinct from zero', () => {
    const summary = summarizePlanCritic(null);
    expect(summary.available).toBe(false);
    expect(formatPlanCriticSection(summary).join('\n')).toContain('取得できませんでした');
    expect(formatPlanCriticSection(summarizePlanCritic([])).join('\n')).not.toContain(
      '取得できませんでした',
    );
  });
});

describe('daily report — plan critic section', () => {
  it('puts the counts in the body and metadata of the report', async () => {
    transitionFindMany.mockResolvedValue(ROWS);
    expect(await runDailyReport()).toBe(1);

    const { reportMarkdown, sections } = sentReport();
    expect(sections.planCritic).toEqual(COUNTS);
    expect(reportMarkdown).toContain(PLAN_CRITIC_HEADING);
    expect(reportMarkdown).toContain('切り詰めで判定不能: 2件（うち指摘あり 1件）');
    expect(reportMarkdown).toContain('指摘を計画の担当へ返した: 1件（指摘 2件）');
    expect(reportMarkdown).toContain('差し戻し枠を使い切り進めた: 1件');
    expect(transitionFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        cause: {
          in: ['plan_critic_incomplete', 'plan_critic_failed', 'plan_critic_exhausted'],
        },
      },
      select: { cause: true, metadata: true },
    });
  });

  it('still ships the report when the transition lookup fails', async () => {
    transitionFindMany.mockRejectedValue(new Error('db down'));
    expect(await runDailyReport()).toBe(1);
    expect(sentReport().sections.planCritic).toMatchObject({ available: false });
    expect(sentReport().reportMarkdown).toContain('取得できませんでした');
  });

  const polish = (rows: Row[] | null) =>
    aiFormatDailyReport(buildDailyReportData(rawWith(rows), new Date()));
  const headings = (markdown: string) => markdown.split(PLAN_CRITIC_HEADING).length - 1;

  it('appends the section when the AI rewrite drops it', async () => {
    aiReply = '# 整形済み';
    const out = await polish(ROWS);
    expect(out.startsWith('# 整形済み')).toBe(true);
    expect(headings(out)).toBe(1);
    expect(out).toContain('切り詰めで判定不能: 2件');
  });

  it('replaces a section the AI rewrote, keeping the sections around it', async () => {
    aiReply = `# 整形済み\n\n${PLAN_CRITIC_HEADING}\n\n本文\n\n### 内訳\n\n- 9件\n\n## 次のキュー\n\n- #1`;
    const out = await polish(ROWS);
    expect(headings(out)).toBe(1);
    expect(out).toContain('指摘を計画の担当へ返した: 1件（指摘 2件）');
    expect(out).toContain('## 次のキュー\n\n- #1');
    expect(out).not.toContain('本文');
    expect(out).not.toContain('9件');
  });

  it('keeps a failed lookup visible after the AI rewrite', async () => {
    aiReply = '# 整形済み';
    expect(await polish(null)).toContain('取得できませんでした');
  });

  it('shows zero counts after the AI rewrite', async () => {
    aiReply = '# 整形済み';
    expect(await polish([])).toContain('切り詰めで判定不能: 0件');
  });

  it('strips every copy of the section and leaves other text alone', () => {
    const twice = `a\n${PLAN_CRITIC_HEADING}\nx\n# b\n${PLAN_CRITIC_HEADING}\ny`;
    expect(stripPlanCriticSection(twice)).toBe('a\n# b');
    expect(stripPlanCriticSection('# a\n\n本文')).toBe('# a\n\n本文');
    expect(stripPlanCriticSection('')).toBe('');
  });
});
