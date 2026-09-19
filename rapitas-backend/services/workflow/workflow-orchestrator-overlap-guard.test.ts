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

const { guardImplementOverlap, resetOverlapGuardState, isOverlapHeld, HOLD_SIGNAL_INTERVAL_MS } =
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
const parked = new Set<number>();

/** Deterministic collaborators: file tokens are whatever sits inside backticks. */
const deps = {
  openPrs: async () => openPrs,
  prFiles: async (_cwd: string, pr: number) => prFiles[pr] ?? [],
  artifact: async (_id: number, type: 'plan' | 'research') => (type === 'plan' ? plan : research),
  parseFiles: (c: string) => [...c.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
  overlap: async (a: string[], b: string[]) => b.filter((f) => a.includes(f)),
  isParked: async (linkedTaskId: number) => parked.has(linkedTaskId),
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
  parked.clear();
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

  test('保留継続中は2分ごとに task.implement_overlap_holding を発火する', async () => {
    await run();
    nowMs += 130_000; // 130s: 2分(120s)経過
    const r1 = await run();
    expect(r1.done).toBe(true);
    const holding1 = events.filter((e) => e.evt === 'task.implement_overlap_holding');
    expect(holding1.length).toBe(1);
    expect(holding1[0]?.fields.holdMs).toBe(130_000);
    nowMs += 130_000; // さらに130s後: 2回目
    const r2 = await run();
    expect(r2.done).toBe(true);
    const holding2 = events.filter((e) => e.evt === 'task.implement_overlap_holding');
    expect(holding2.length).toBe(2);
    expect(holding2[1]?.fields.holdMs).toBe(260_000);
  });

  test('2分未満の再評価では task.implement_overlap_holding を発火しない', async () => {
    await run();
    nowMs += 10_000;
    await run();
    nowMs += 60_000; // 累計70秒、まだ2分未満
    await run();
    expect(events.filter((e) => e.evt === 'task.implement_overlap_holding').length).toBe(0);
  });

  test('タイムアウト解放と同一tickで task.implement_overlap_holding は混入しない', async () => {
    await run();
    nowMs += MAX_HOLD_MS;
    const r = await run();
    expect(r.done).toBe(false);
    expect(events.some((e) => e.evt === 'task.implement_overlap_holding')).toBe(false);
    expect(events.at(-1)?.evt).toBe('task.implement_overlap_released');
  });

  test('950/951/953を模した複数タスク同時保留で周期シグナルが独立発火する', async () => {
    const prsByTask: Record<number, number> = { 950: 950, 951: 951, 953: 953 };
    for (const taskId of Object.keys(prsByTask).map(Number)) {
      openPrs = [{ prNumber: taskId, linkedTaskId: taskId + 1000, createdAt: fresh() }];
      prFiles = { [taskId]: [SUPPRESSIONS] };
      await guardImplementOverlap(taskId, IMPLEMENTER, TASK, 'research_done', deps);
    }
    nowMs += HOLD_SIGNAL_INTERVAL_MS + 10_000;
    // taskId 950だけ周期チェックを進める
    openPrs = [{ prNumber: 950, linkedTaskId: 1950, createdAt: fresh() }];
    prFiles = { 950: [SUPPRESSIONS] };
    await guardImplementOverlap(950, IMPLEMENTER, TASK, 'research_done', deps);
    const holdingEvents = events.filter((e) => e.evt === 'task.implement_overlap_holding');
    expect(holdingEvents.length).toBe(1);
    expect(holdingEvents[0]?.fields.task).toBe(950);
  });

  test('保留→解放→再保留で lastSignalAt が新エピソードの since から再計算される', async () => {
    await run();
    nowMs += 60_000;
    openPrs = [];
    await run(); // 解放 (no_overlap)
    nowMs += MAX_HOLD_MS; // releasedAtからの再保留抑止期間を過ぎる
    openPrs = [{ prNumber: 533, linkedTaskId: 758, createdAt: fresh() }];
    await run(); // 再保留（新エピソード開始）
    nowMs += 70_000; // 新エピソード起点からは2分未満
    await run();
    expect(events.filter((e) => e.evt === 'task.implement_overlap_holding').length).toBe(0);
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

  test('auto-merge が枯渇駐機した PR は待たない（#764⇄#537 の循環待ち事例）', async () => {
    openPrs = [{ prNumber: 537, linkedTaskId: 755, createdAt: fresh() }];
    prFiles = { 537: [SUPPRESSIONS] };
    parked.add(755);
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

  test('保留継続中、2分間隔で task.implement_overlap_holding が発火する（task 947）', async () => {
    await run();
    for (let i = 0; i < 11; i++) {
      nowMs += 10_000;
      const r = await run();
      expect(r.done).toBe(true);
    }
    expect(events.filter((e) => e.evt === 'task.implement_overlap_holding').length).toBe(0);
    nowMs += 10_000;
    const r = await run();
    expect(r.done).toBe(true);
    const holding = events.filter((e) => e.evt === 'task.implement_overlap_holding');
    expect(holding.length).toBe(1);
    expect(holding[0]?.fields.prs).toEqual([533]);
  });

  test('24分間・144回の連続再評価でも保留（再試行）が途切れない（task 947、受入条件3）', async () => {
    let heldCount = 0;
    for (let i = 0; i < 144; i++) {
      const r = await run();
      expect(r.done).toBe(true);
      if (r.done && r.result.skipped) heldCount++;
      nowMs += 10_000;
    }
    expect(heldCount).toBe(144);
    const holding = events.filter((e) => e.evt === 'task.implement_overlap_holding');
    // Calls happen at t=0,10s,...,1430s (143 steps after the first); a signal
    // fires whenever that elapsed time crosses another HOLD_SIGNAL_INTERVAL_MS.
    const expectedSignals = Math.floor((143 * 10_000) / HOLD_SIGNAL_INTERVAL_MS);
    expect(holding.length).toBe(expectedSignals);
  });

  test('保留解除後に再保留した場合、周期シグナルは新しい holdSince を起点に計算される', async () => {
    await run();
    nowMs += 60_000;
    openPrs = [];
    await run();
    expect(isOverlapHeld(759)).toBe(false);
    nowMs += MAX_HOLD_MS;
    openPrs = [{ prNumber: 533, linkedTaskId: 758, createdAt: fresh() }];
    await run();
    nowMs += HOLD_SIGNAL_INTERVAL_MS - 10_000;
    const r = await run();
    expect(r.done).toBe(true);
    expect(events.filter((e) => e.evt === 'task.implement_overlap_holding').length).toBe(0);
  });
});

describe('isOverlapHeld', () => {
  test('保留発生直後は true を返す', async () => {
    await run();
    expect(isOverlapHeld(759)).toBe(true);
  });

  test('解放後は false を返す', async () => {
    await run();
    nowMs += 60_000;
    openPrs = [];
    await run();
    expect(isOverlapHeld(759)).toBe(false);
  });

  test('一度も保留されていない taskId は false を返す', () => {
    expect(isOverlapHeld(999999)).toBe(false);
  });
});
