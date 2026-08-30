/**
 * workflow-orchestrator-overlap-guard.test
 *
 * Fixtures follow the 2026-08-30 conflict: #759 (research names
 * log-health-suppressions.ts) starting its implementer while #758's PR #533
 * was still open on that file.
 *
 * Run this file on its own (as the verification gate does): bun's mock.module
 * is process-global and this file replaces the logger, observability and the
 * merge-barrier settings.
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';

afterAll(() => {
  delete process.env.RAPITAS_IMPLEMENT_OVERLAP_HOLD;
});

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
const events: Array<{ evt: string; fields: Record<string, unknown> }> = [];
mock.module('../observability', () => ({
  logCycleEvent: (evt: string, fields: Record<string, unknown>) => {
    events.push({ evt, fields });
  },
}));
const MAX_HOLD_MS = 30 * 60 * 1000;
mock.module('../scheduling/merge-barrier/merge-barrier', () => ({
  getMergeBarrierMaxHoldMs: () => MAX_HOLD_MS,
}));

const { guardImplementOverlap, resetOverlapGuardState } =
  await import('./workflow-orchestrator-overlap-guard');

const IMPLEMENTER = { role: 'implementer', outputFile: null, nextStatus: 'in_progress' } as const;
const RESEARCHER = {
  role: 'researcher',
  outputFile: 'research',
  nextStatus: 'research_done',
} as const;
const TASK = { themeId: 1, theme: { workingDirectory: 'C:/repo' } };
const SUPPRESSIONS = 'rapitas-backend/services/system/log-health-suppressions.ts';

let nowMs = 1_000_000;
let plan: string | null = null;
let research: string | null = `対象: \`${SUPPRESSIONS}\``;
const fresh = () => new Date(nowMs - 60_000); // 1 min old — well inside the freshness window
let openPrs: Array<{ prNumber: number; linkedTaskId: number | null; createdAt: Date | null }> = [];
let prFiles: Record<number, string[]> = { 533: [SUPPRESSIONS] };

/** Deterministic collaborators: file tokens are whatever sits inside backticks. */
const deps = {
  openPrs: async () => openPrs,
  prFiles: async (_cwd: string, pr: number) => prFiles[pr] ?? [],
  artifact: async (_id: number, type: 'plan' | 'research') => (type === 'plan' ? plan : research),
  parseFiles: (c: string) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
  overlap: async (a: string[], b: string[]) => b.filter((f) => a.includes(f)),
  now: () => nowMs,
};

const run = (transition: typeof IMPLEMENTER | typeof RESEARCHER = IMPLEMENTER, taskId = 759) =>
  guardImplementOverlap(taskId, transition, TASK, 'research_done', deps);

beforeEach(() => {
  resetOverlapGuardState();
  events.length = 0;
  nowMs = 1_000_000;
  plan = null;
  research = `対象: \`${SUPPRESSIONS}\``;
  openPrs = [{ prNumber: 533, linkedTaskId: 758, createdAt: fresh() }];
  prFiles = { 533: [SUPPRESSIONS] };
  delete process.env.RAPITAS_IMPLEMENT_OVERLAP_HOLD;
});

describe('guardImplementOverlap', () => {
  test('lightweight: research.md の言及ファイルがオープンPRと重なれば保留（skipped, held）', async () => {
    const r = await run();
    expect(r.done).toBe(true);
    if (!r.done) return;
    expect(r.result.skipped).toBe(true);
    expect(r.result.success).toBe(true);
    expect(r.result.status).toBe('research_done');
    expect(r.result.held).toContain('#533');
    expect(r.result.held).toContain('log-health-suppressions.ts');
    expect(events.map((e) => e.evt)).toEqual(['task.implement_overlap_hold']);
    expect(events[0]?.fields.prs).toEqual([533]);
  });

  test('plan.md があれば research.md より優先して比較する', async () => {
    plan = '変更: `services/other/unrelated.ts`';
    expect((await run()).done).toBe(false);
  });

  test('保留中の再評価はイベントを重ねず保留を続ける', async () => {
    await run();
    nowMs += 10_000;
    const r = await run();
    expect(r.done).toBe(true);
    expect(events.filter((e) => e.evt === 'task.implement_overlap_hold').length).toBe(1);
  });

  test('重なりが消えれば解放イベントを出して進む', async () => {
    await run();
    nowMs += 60_000;
    openPrs = [];
    const r = await run();
    expect(r.done).toBe(false);
    const rel = events.find((e) => e.evt === 'task.implement_overlap_released');
    expect(rel?.fields.reason).toBe('no_open_pr');
    expect(rel?.fields.holdMs).toBe(60_000);
  });

  test('上限を過ぎたら timeout 解放で進み、直後の再評価で再保留しない', async () => {
    await run();
    nowMs += MAX_HOLD_MS;
    const r = await run();
    expect(r.done).toBe(false);
    expect(events.at(-1)?.evt).toBe('task.implement_overlap_released');
    expect(events.at(-1)?.fields.reason).toBe('timeout');
    nowMs += 10_000;
    expect((await run()).done).toBe(false);
    expect(events.filter((e) => e.evt === 'task.implement_overlap_hold').length).toBe(1);
  });

  test('自タスクの PR は待つ理由にならない', async () => {
    openPrs = [{ prNumber: 540, linkedTaskId: 759, createdAt: fresh() }];
    prFiles = { 540: [SUPPRESSIONS] };
    expect((await run()).done).toBe(false);
    expect(events.length).toBe(0);
  });

  test('6時間以上開きっぱなしの stale PR は待つ理由にならない（#435/#467 事例）', async () => {
    openPrs = [
      { prNumber: 435, linkedTaskId: 643, createdAt: new Date(nowMs - 7 * 60 * 60 * 1000) },
      { prNumber: 467, linkedTaskId: 671, createdAt: null },
    ];
    prFiles = { 435: [SUPPRESSIONS], 467: [SUPPRESSIONS] };
    expect((await run()).done).toBe(false);
    expect(events.length).toBe(0);
  });

  test('implementer 以外の役割は素通し', async () => {
    expect((await run(RESEARCHER)).done).toBe(false);
  });

  test('成果物にファイル言及が無ければ素通し', async () => {
    research = '調査結果のみ。';
    expect((await run()).done).toBe(false);
  });

  test('照会が失敗したら fail open', async () => {
    const r = await guardImplementOverlap(759, IMPLEMENTER, TASK, 'research_done', {
      ...deps,
      openPrs: async () => {
        throw new Error('gh down');
      },
    });
    expect(r.done).toBe(false);
  });

  test('RAPITAS_IMPLEMENT_OVERLAP_HOLD=off で無効化', async () => {
    process.env.RAPITAS_IMPLEMENT_OVERLAP_HOLD = 'off';
    expect((await run()).done).toBe(false);
  });
});
