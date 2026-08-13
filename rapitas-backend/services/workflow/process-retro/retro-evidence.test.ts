/**
 * retro-evidence ユニットテスト
 *
 * 証拠バンドル純関数系(countCauses / computePhaseTimings / extractCriticReasons /
 * isCleanRound / buildEvidenceBundle)と fetchRetroRows のフェイルオープンを検証する。
 */
import { describe, test, expect, mock } from 'bun:test';

const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

// HACK(agent): Bun mock型推論の制限 — `as any`

const transitionFindMany = mock(() => Promise.resolve([])) as any;
mock.module('../../../config/database', () => ({
  prisma: { workflowTransition: { findMany: transitionFindMany } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const {
  countCauses,
  computePhaseTimings,
  computeQueueWaitMs,
  extractCriticReasons,
  isCleanRound,
  buildEvidenceBundle,
  fetchRetroRows,
} = await import('./retro-evidence');
import type { RetroTransitionRow } from './retro-types';

let nextId = 1;
const row = (over: Partial<RetroTransitionRow> = {}): RetroTransitionRow => ({
  id: nextId++,
  fromStatus: 'draft',
  toStatus: 'research_done',
  actor: 'system',
  cause: 'file_saved:research',
  phase: null,
  metadata: '{}',
  invariantViolation: false,
  createdAt: new Date(0),
  ...over,
});

describe('countCauses', () => {
  test('cause分類別に集計し、replanはrepairと二重計上される', () => {
    const rows = [
      row({ cause: 'research_critic_failed' }),
      row({ cause: 'plan_critic_exhausted' }),
      row({ cause: 'verify_repair' }),
      row({ cause: 'ci_repair' }),
      row({ cause: 'plan_invalid_replan' }),
      row({ cause: 'rejected_resave_blocked' }),
      row({ cause: 'file_saved:verify' }),
    ];
    const counts = countCauses(rows);
    expect(counts.criticRebounds).toBe(2);
    // repairCount は replan を含む10種の合計(verify_repair + ci_repair + plan_invalid_replan)。
    expect(counts.repairCount).toBe(3);
    expect(counts.replanCount).toBe(1);
    expect(counts.anomalyCount).toBe(1);
    expect(counts.invariantCount).toBe(0);
  });

  test('invariantViolation=true の行数を数える', () => {
    const rows = [row({ invariantViolation: true }), row(), row({ invariantViolation: true })];
    expect(countCauses(rows).invariantCount).toBe(2);
  });

  test('空入力は全カウント0', () => {
    expect(countCauses([])).toEqual({
      criticRebounds: 0,
      repairCount: 0,
      replanCount: 0,
      anomalyCount: 0,
      invariantCount: 0,
    });
  });
});

describe('computePhaseTimings', () => {
  test('0件は空オブジェクト', () => {
    expect(computePhaseTimings([])).toEqual({});
  });

  test('1件は区間なしで空オブジェクト', () => {
    expect(computePhaseTimings([row()])).toEqual({});
  });

  test('正常系: 隣接区間をtoStatusに帰属し、最終状態は含めない', () => {
    const rows = [
      row({ toStatus: 'research_done', createdAt: new Date(0) }),
      row({ toStatus: 'plan_created', createdAt: new Date(60_000) }),
      row({ toStatus: 'in_progress', createdAt: new Date(180_000) }),
    ];
    expect(computePhaseTimings(rows)).toEqual({ research_done: 60_000, plan_created: 120_000 });
  });

  test('順不同入力もソート後に同一結果', () => {
    const rows = [
      row({ toStatus: 'in_progress', createdAt: new Date(180_000) }),
      row({ toStatus: 'research_done', createdAt: new Date(0) }),
      row({ toStatus: 'plan_created', createdAt: new Date(60_000) }),
    ];
    expect(computePhaseTimings(rows)).toEqual({ research_done: 60_000, plan_created: 120_000 });
  });

  test('同名toStatusは加算される', () => {
    const rows = [
      row({ toStatus: 'in_progress', createdAt: new Date(0) }),
      row({ toStatus: 'verify_failed', createdAt: new Date(10_000) }),
      row({ toStatus: 'in_progress', createdAt: new Date(15_000) }),
      row({ toStatus: 'completed', createdAt: new Date(45_000) }),
    ];
    expect(computePhaseTimings(rows)).toEqual({ in_progress: 40_000, verify_failed: 5_000 });
  });

  test('同時刻はid昇順で安定し、負区間は0クランプ', () => {
    const at = new Date(30_000);
    const rows = [
      row({ id: 102, toStatus: 'b', createdAt: at }),
      row({ id: 101, toStatus: 'a', createdAt: at }),
      row({ id: 103, toStatus: 'c', createdAt: new Date(40_000) }),
    ];
    // a→b は同時刻(区間0)、b→c は10秒。負値は発生しない。
    expect(computePhaseTimings(rows)).toEqual({ a: 0, b: 10_000 });
  });
});

// task#516 実データ相当: reconciler_requeue×2 の後、auto-run 非稼働の10日間を経て
// intake_enriched(初回の phase 付き遷移)で起動したタイムライン。
const DAY = 86_400_000;
const MIN = 60_000;
const task516Rows = (): RetroTransitionRow[] => [
  row({ toStatus: 'draft', cause: 'reconciler_requeue', phase: null, createdAt: new Date(0) }),
  row({
    toStatus: 'draft',
    cause: 'reconciler_requeue',
    phase: null,
    createdAt: new Date(2 * DAY),
  }),
  row({
    toStatus: 'draft',
    cause: 'intake_enriched',
    phase: 'research',
    createdAt: new Date(10 * DAY),
  }),
  row({
    toStatus: 'research_done',
    cause: 'phase_completed:researcher',
    phase: 'research',
    createdAt: new Date(10 * DAY + 7 * MIN),
  }),
  row({
    toStatus: 'in_progress',
    cause: 'phase_completed:implementer',
    phase: 'implementer',
    createdAt: new Date(10 * DAY + 17 * MIN),
  }),
  row({
    toStatus: 'completed',
    cause: 'verify_passed',
    phase: 'verify',
    createdAt: new Date(10 * DAY + 20 * MIN),
  }),
];

describe('キュー待機の分離(初回ディスパッチ前)', () => {
  test('task516再現: 初回ディスパッチ前の10日間は待機に分離され、全実行フェーズは120分未満', () => {
    const timings = computePhaseTimings(task516Rows());
    // draft 滞在は intake_enriched→research_done の実行時間(7分)のみに縮む。
    expect(timings.draft).toBe(7 * MIN);
    expect(timings.research_done).toBe(10 * MIN);
    expect(timings.in_progress).toBe(3 * MIN);
    for (const ms of Object.values(timings)) {
      expect(ms).toBeLessThan(120 * MIN);
    }
    expect(computeQueueWaitMs(task516Rows())).toBe(10 * DAY);
  });

  test('phase付き遷移が存在しない場合は分離せず従来どおり全ギャップを帰属する', () => {
    const rows = [
      row({ toStatus: 'draft', phase: null, createdAt: new Date(0) }),
      row({ toStatus: 'research_done', phase: null, createdAt: new Date(2 * DAY) }),
      row({ toStatus: 'completed', phase: null, createdAt: new Date(2 * DAY + 5 * MIN) }),
    ];
    expect(computePhaseTimings(rows)).toEqual({ draft: 2 * DAY, research_done: 5 * MIN });
    expect(computeQueueWaitMs(rows)).toBe(0);
  });

  test('先頭行からphase付き(即時ディスパッチ)なら待機は0', () => {
    const rows = [
      row({
        toStatus: 'draft',
        cause: 'intake_enriched',
        phase: 'research',
        createdAt: new Date(0),
      }),
      row({ toStatus: 'research_done', phase: 'research', createdAt: new Date(30 * MIN) }),
      row({ toStatus: 'completed', phase: 'verify', createdAt: new Date(40 * MIN) }),
    ];
    expect(computeQueueWaitMs(rows)).toBe(0);
    expect(computePhaseTimings(rows)).toEqual({ draft: 30 * MIN, research_done: 10 * MIN });
  });

  test('ディスパッチ後のdraft戻り(blocked_auto_retry)はdraft滞在として残る', () => {
    const rows = [
      row({
        toStatus: 'draft',
        cause: 'intake_enriched',
        phase: 'research',
        createdAt: new Date(0),
      }),
      row({ toStatus: 'in_progress', phase: 'implementer', createdAt: new Date(10 * MIN) }),
      row({
        toStatus: 'draft',
        cause: 'blocked_auto_retry',
        phase: null,
        createdAt: new Date(15 * MIN),
      }),
      row({ toStatus: 'completed', phase: 'verify', createdAt: new Date(55 * MIN) }),
    ];
    // 中盤の draft 40分は実行中の再キュー待ちであり、待機ではなくdraft滞在に帰属する。
    expect(computeQueueWaitMs(rows)).toBe(0);
    expect(computePhaseTimings(rows)).toEqual({
      draft: 10 * MIN + 40 * MIN,
      in_progress: 5 * MIN,
    });
  });

  test('空入力・1件入力は待機0', () => {
    expect(computeQueueWaitMs([])).toBe(0);
    expect(computeQueueWaitMs([row()])).toBe(0);
  });
});

describe('extractCriticReasons', () => {
  test('critic causeのmetadata.reasons配列を平坦化する', () => {
    const rows = [
      row({
        cause: 'research_critic_failed',
        metadata: JSON.stringify({ reasons: ['出典なし', '  結論が曖昧  '] }),
      }),
      row({ cause: 'plan_critic_failed', metadata: JSON.stringify({ reasons: ['DoD欠落'] }) }),
    ];
    expect(extractCriticReasons(rows)).toEqual(['出典なし', '結論が曖昧', 'DoD欠落']);
  });

  test('壊れたmetadataの行はスキップし、他行は生きる', () => {
    const rows = [
      row({ cause: 'research_critic_failed', metadata: '{broken json' }),
      row({ cause: 'plan_critic_failed', metadata: JSON.stringify({ reasons: ['理由A'] }) }),
    ];
    expect(extractCriticReasons(rows)).toEqual(['理由A']);
  });

  test('critic以外のcauseや非配列reasonsは無視する', () => {
    const rows = [
      row({ cause: 'verify_repair', metadata: JSON.stringify({ reason: '修復理由' }) }),
      row({ cause: 'research_critic_failed', metadata: JSON.stringify({ reasons: 'not-array' }) }),
      row({
        cause: 'research_critic_failed',
        metadata: JSON.stringify({ reasons: [1, '', '有効'] }),
      }),
    ];
    expect(extractCriticReasons(rows)).toEqual(['有効']);
  });
});

describe('isCleanRound', () => {
  const bundle = (over: Partial<ReturnType<typeof buildEvidenceBundle>> = {}) => ({
    ...buildEvidenceBundle([], { taskId: 1, title: 't' }),
    ...over,
  });

  test('全カウント0ならクリーン', () => {
    expect(isCleanRound(bundle())).toBe(true);
  });

  test.each([
    ['criticRebounds'],
    ['repairCount'],
    ['replanCount'],
    ['anomalyCount'],
    ['invariantCount'],
  ] as const)('%s が1ならクリーンでない', (field) => {
    expect(isCleanRound(bundle({ [field]: 1 }))).toBe(false);
  });
});

describe('buildEvidenceBundle', () => {
  test('タイムラインは昇順ソートされ、全集計が合成される', () => {
    const rows = [
      row({ toStatus: 'in_progress', createdAt: new Date(120_000), cause: 'verify_repair' }),
      row({
        toStatus: 'research_done',
        createdAt: new Date(0),
        cause: 'research_critic_failed',
        metadata: JSON.stringify({ reasons: ['出典なし'] }),
      }),
      row({ toStatus: 'plan_created', createdAt: new Date(60_000), invariantViolation: true }),
    ];
    const bundle = buildEvidenceBundle(rows, { taskId: 42, title: 'テストタスク' });
    expect(bundle.taskId).toBe(42);
    expect(bundle.title).toBe('テストタスク');
    expect(bundle.timeline.map((t) => t.toStatus)).toEqual([
      'research_done',
      'plan_created',
      'in_progress',
    ]);
    expect(bundle.criticRebounds).toBe(1);
    expect(bundle.repairCount).toBe(1);
    expect(bundle.invariantCount).toBe(1);
    expect(bundle.criticReasons).toEqual(['出典なし']);
    expect(bundle.phaseTimings).toEqual({ research_done: 60_000, plan_created: 60_000 });
    // phase 付き遷移が無いデータでは待機は分離されない。
    expect(bundle.queueWaitMs).toBe(0);
  });

  test('task516相当のタイムラインでは queueWaitMs に待機が集計される', () => {
    const bundle = buildEvidenceBundle(task516Rows(), { taskId: 516, title: 't516' });
    expect(bundle.queueWaitMs).toBe(10 * DAY);
    expect(bundle.phaseTimings.draft).toBe(7 * MIN);
  });

  test('第3引数なし(既存呼び出し)では experiment フィールドを持たない', () => {
    const bundle = buildEvidenceBundle([], { taskId: 1, title: 't' });
    expect('experiment' in bundle).toBe(false);
  });

  test('実験情報を渡すと experiment に格納され、isCleanRound には影響しない', () => {
    const experiment = { role: 'planner', hypothesisId: 7, statement: '検証中の仮説の主張文' };
    const bundle = buildEvidenceBundle([], { taskId: 1, title: 't' }, experiment);
    expect(bundle.experiment).toEqual(experiment);
    // 実験中フラグは情報提供のみ — クリーンラウンド判定を変えない(AI呼び出しコスト防止)。
    expect(isCleanRound(bundle)).toBe(true);
  });
});

describe('fetchRetroRows', () => {
  test('DBエラーは空配列にフェイルオープンする', async () => {
    transitionFindMany.mockRejectedValueOnce(new Error('db down'));
    expect(await fetchRetroRows(1)).toEqual([]);
  });

  test('取得行をそのまま返す', async () => {
    const rows = [row()];
    transitionFindMany.mockResolvedValueOnce(rows);
    expect(await fetchRetroRows(1)).toEqual(rows);
  });
});
