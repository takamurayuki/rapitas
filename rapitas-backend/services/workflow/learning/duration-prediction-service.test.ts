/**
 * duration-prediction-service ユニットテスト
 *
 * computeDurationPrediction（中央値/四分位/信頼度・汚染行除外・サンプル閾値・
 * theme×mode絞り込み）、predictAndPersistTaskDuration（upsert・fail-open）、
 * recordDurationPredictionError（誤差確定・no-op・fail-open）を prisma モックで
 * 検証する。モックの findMany は where の汚染フィルタを実際に適用するため、
 * サービス側のフィルタを外すと汚染行ケースが RED になる。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '',
}));

interface LearningRow {
  actualDurationMinutes: number | null;
  estimatedDuration: number | null;
  complexityFactors: string;
  themeId: number | null;
  workflowMode: string;
  success: boolean;
}

let learningRows: LearningRow[] = [];
let capturedWhere: Record<string, unknown> | null = null;

// per-task 完了行（recordWorkflowCompletion 由来）を模す既定行。
function makeRow(minutes: number, overrides: Partial<LearningRow> = {}): LearningRow {
  return {
    actualDurationMinutes: minutes,
    estimatedDuration: 60,
    complexityFactors: '{"keyword":1}',
    themeId: 1,
    workflowMode: 'standard',
    success: true,
    ...overrides,
  };
}

interface WhereShape {
  workflowMode?: string;
  themeId?: number;
  success?: boolean;
  actualDurationMinutes?: { not: unknown };
  estimatedDuration?: { not: unknown };
  complexityFactors?: { not: unknown };
}

const learningFindMany = mock((args: { where: Record<string, unknown> }) => {
  capturedWhere = args.where;
  const w = args.where as WhereShape;
  let rows = learningRows;
  if (typeof w.workflowMode === 'string')
    rows = rows.filter((r) => r.workflowMode === w.workflowMode);
  if (typeof w.themeId === 'number') rows = rows.filter((r) => r.themeId === w.themeId);
  if (typeof w.success === 'boolean') rows = rows.filter((r) => r.success === w.success);
  if (w.actualDurationMinutes?.not === null)
    rows = rows.filter((r) => r.actualDurationMinutes !== null);
  if (w.estimatedDuration?.not === null) rows = rows.filter((r) => r.estimatedDuration !== null);
  if (typeof w.complexityFactors?.not === 'string')
    rows = rows.filter((r) => r.complexityFactors !== w.complexityFactors?.not);
  return Promise.resolve(rows.map((r) => ({ actualDurationMinutes: r.actualDurationMinutes })));
});

let taskRow: { themeId: number | null; workflowMode: string | null } | null = null;
const taskFindUnique = mock(() => Promise.resolve(taskRow));

interface PredictionRow {
  taskId: number;
  groupingKey: string;
  predictable: boolean;
  sampleSize: number;
  medianMinutes: number | null;
  p25Minutes: number | null;
  p75Minutes: number | null;
  confidence: number;
  actualDurationMinutes: number | null;
  errorMinutes: number | null;
  errorRatio: number | null;
}

function makePredictionRow(overrides: Partial<PredictionRow> = {}): PredictionRow {
  return {
    taskId: 579,
    groupingKey: 'theme:1|mode:standard',
    predictable: true,
    sampleSize: 5,
    medianMinutes: 100,
    p25Minutes: 80,
    p75Minutes: 120,
    confidence: 0.15,
    actualDurationMinutes: null,
    errorMinutes: null,
    errorRatio: null,
    ...overrides,
  };
}

let predictionRow: PredictionRow | null = null;
const predictionFindUnique = mock(() => Promise.resolve(predictionRow));
const predictionUpsert = mock((args: unknown) => Promise.resolve(args));
const predictionUpdate = mock((args: unknown) => Promise.resolve(args));

const prismaMock: Record<string, unknown> = {
  workflowLearningRecord: { findMany: learningFindMany },
  task: { findUnique: taskFindUnique },
  taskDurationPrediction: {
    findUnique: predictionFindUnique,
    upsert: predictionUpsert,
    update: predictionUpdate,
  },
};

mock.module('../../../config', () => ({ prisma: prismaMock }));

const { computeDurationPrediction, predictAndPersistTaskDuration, recordDurationPredictionError } =
  await import('./duration-prediction-service');

beforeEach(() => {
  learningRows = [];
  capturedWhere = null;
  taskRow = null;
  predictionRow = null;
  learningFindMany.mockClear();
  taskFindUnique.mockClear();
  predictionFindUnique.mockClear();
  predictionUpsert.mockClear();
  predictionUpdate.mockClear();
  taskFindUnique.mockImplementation(() => Promise.resolve(taskRow));
  delete process.env.RAPITAS_PREDICTION_MIN_SAMPLES;
});

describe('computeDurationPrediction — 統計量', () => {
  test('奇数件: 中央値=中間値、p25/p75 は nearest-rank', async () => {
    learningRows = [30, 10, 50, 20, 40].map((m) => makeRow(m));
    const p = await computeDurationPrediction(1, 'standard');
    expect(p).toEqual({
      predictable: true,
      sampleSize: 5,
      medianMinutes: 30,
      p25Minutes: 20, // sorted[ceil(0.25*5)-1] = sorted[1]
      p75Minutes: 40, // sorted[ceil(0.75*5)-1] = sorted[3]
      confidence: 0.08, // round2((5/20) * (1 - 20/30))
      groupingKey: 'theme:1|mode:standard',
    });
  });

  test('偶数件: 中央値は中間2値の平均を round', async () => {
    learningRows = [10, 20, 30, 40, 50, 60].map((m) => makeRow(m));
    const p = await computeDurationPrediction(1, 'standard');
    expect(p.medianMinutes).toBe(35);
    expect(p.p25Minutes).toBe(20); // sorted[ceil(1.5)-1]
    expect(p.p75Minutes).toBe(50); // sorted[ceil(4.5)-1]
    // spread = 1 - 30/35 = 0.14... < 0.2 → 0.2 に下限クランプ; (6/20)*0.2 = 0.06
    expect(p.confidence).toBe(0.06);
  });

  test('外れ値が混じっても中央値は頑健（IQR=0 → spread=1）', async () => {
    learningRows = [10, 10, 10, 10, 1000].map((m) => makeRow(m));
    const p = await computeDurationPrediction(1, 'standard');
    expect(p.medianMinutes).toBe(10);
    expect(p.confidence).toBe(0.25); // (5/20) * 1
  });

  test('median=0 は spread を 0.2 に固定しゼロ除算しない', async () => {
    learningRows = [0, 0, 0, 0, 0].map((m) => makeRow(m));
    const p = await computeDurationPrediction(1, 'standard');
    expect(p.medianMinutes).toBe(0);
    expect(p.confidence).toBe(0.05); // (5/20) * 0.2
  });
});

describe('computeDurationPrediction — 汚染行除外とスコープ', () => {
  test('per-execution 汚染行（estimatedDuration=null）は分布から除外される', async () => {
    learningRows = [
      ...[100, 100, 100, 100, 100].map((m) => makeRow(m)),
      // recordWorkflowExecution 由来行: estimatedDuration 未設定・complexityFactors 既定値
      ...[3, 3, 3, 3, 3].map((m) =>
        makeRow(m, { estimatedDuration: null, complexityFactors: '{}' }),
      ),
    ];
    const p = await computeDurationPrediction(1, 'standard');
    expect(p.sampleSize).toBe(5);
    expect(p.medianMinutes).toBe(100);
    const where = capturedWhere as WhereShape;
    expect(where.estimatedDuration).toEqual({ not: null });
    expect(where.complexityFactors).toEqual({ not: '{}' });
    expect(where.success).toBe(true);
  });

  test('themeId 指定 → where.themeId と groupingKey に反映', async () => {
    learningRows = [10, 20, 30, 40, 50].map((m) => makeRow(m, { themeId: 42 }));
    const p = await computeDurationPrediction(42, 'standard');
    expect((capturedWhere as WhereShape).themeId).toBe(42);
    expect(p.groupingKey).toBe('theme:42|mode:standard');
  });

  test('themeId null → クロステーマ検索（where に themeId なし）', async () => {
    learningRows = [10, 20, 30, 40, 50].map((m) => makeRow(m, { themeId: 7 }));
    const p = await computeDurationPrediction(null, 'standard');
    expect(capturedWhere && 'themeId' in capturedWhere).toBe(false);
    expect(p.groupingKey).toBe('theme:all|mode:standard');
    expect(p.predictable).toBe(true);
  });

  test('mode が合わない行は母集団に入らない', async () => {
    learningRows = [10, 20, 30, 40, 50].map((m) => makeRow(m, { workflowMode: 'lightweight' }));
    const p = await computeDurationPrediction(1, 'standard');
    expect(p.predictable).toBe(false);
    expect(p.sampleSize).toBe(0);
  });
});

describe('computeDurationPrediction — サンプル閾値', () => {
  test('閾値未満（n=4）は predictable=false で数値を捏造しない', async () => {
    learningRows = [10, 20, 30, 40].map((m) => makeRow(m));
    const p = await computeDurationPrediction(1, 'standard');
    expect(p).toEqual({
      predictable: false,
      sampleSize: 4,
      medianMinutes: null,
      p25Minutes: null,
      p75Minutes: null,
      confidence: 0,
      groupingKey: 'theme:1|mode:standard',
    });
  });

  test('閾値ちょうど（n=5）は予測可能', async () => {
    learningRows = [10, 20, 30, 40, 50].map((m) => makeRow(m));
    expect((await computeDurationPrediction(1, 'standard')).predictable).toBe(true);
  });

  test('RAPITAS_PREDICTION_MIN_SAMPLES で閾値を上書きできる', async () => {
    process.env.RAPITAS_PREDICTION_MIN_SAMPLES = '7';
    learningRows = [10, 20, 30, 40, 50, 60].map((m) => makeRow(m));
    expect((await computeDurationPrediction(1, 'standard')).predictable).toBe(false);
  });
});

describe('predictAndPersistTaskDuration', () => {
  test('タスクあり → taskId で upsert（create に taskId、update は予測フィールドのみ）', async () => {
    taskRow = { themeId: 1, workflowMode: 'standard' };
    learningRows = [30, 10, 50, 20, 40].map((m) => makeRow(m));
    const p = await predictAndPersistTaskDuration(579);
    expect(p?.medianMinutes).toBe(30);
    expect(predictionUpsert).toHaveBeenCalledTimes(1);
    const call = predictionUpsert.mock.calls[0][0] as {
      where: { taskId: number };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(call.where.taskId).toBe(579);
    expect(call.create.taskId).toBe(579);
    expect(call.create.medianMinutes).toBe(30);
    expect(call.create.groupingKey).toBe('theme:1|mode:standard');
    expect('taskId' in call.update).toBe(false);
    // 再予測が解決済みの実測/誤差を消さないこと（update は予測フィールドのみ）
    expect('actualDurationMinutes' in call.update).toBe(false);
    expect('errorMinutes' in call.update).toBe(false);
  });

  test('workflowMode null は comprehensive にフォールバック', async () => {
    taskRow = { themeId: null, workflowMode: null };
    learningRows = [10, 20, 30, 40, 50].map((m) => makeRow(m, { workflowMode: 'comprehensive' }));
    const p = await predictAndPersistTaskDuration(579);
    expect(p?.groupingKey).toBe('theme:all|mode:comprehensive');
  });

  test('タスクなし → null を返し upsert しない', async () => {
    taskRow = null;
    expect(await predictAndPersistTaskDuration(999)).toBeNull();
    expect(predictionUpsert).not.toHaveBeenCalled();
  });

  test('delegate 未生成（再起動前）でも予測は返し、永続化のみスキップ', async () => {
    taskRow = { themeId: 1, workflowMode: 'standard' };
    learningRows = [10, 20, 30, 40, 50].map((m) => makeRow(m));
    const saved = prismaMock.taskDurationPrediction;
    delete prismaMock.taskDurationPrediction;
    try {
      const p = await predictAndPersistTaskDuration(579);
      expect(p?.predictable).toBe(true);
      expect(predictionUpsert).not.toHaveBeenCalled();
    } finally {
      prismaMock.taskDurationPrediction = saved;
    }
  });

  test('DB 例外は握りつぶして null（fail-open）', async () => {
    taskFindUnique.mockImplementation(() => Promise.reject(new Error('db down')));
    expect(await predictAndPersistTaskDuration(579)).toBeNull();
  });
});

describe('recordDurationPredictionError', () => {
  test('予測あり完了 → 実測・errorMinutes・errorRatio・resolvedAt を更新', async () => {
    predictionRow = makePredictionRow({ medianMinutes: 100 });
    await recordDurationPredictionError(579, 130);
    expect(predictionUpdate).toHaveBeenCalledTimes(1);
    const call = predictionUpdate.mock.calls[0][0] as {
      where: { taskId: number };
      data: Record<string, unknown>;
    };
    expect(call.where.taskId).toBe(579);
    expect(call.data.actualDurationMinutes).toBe(130);
    expect(call.data.errorMinutes).toBe(30);
    expect(call.data.errorRatio).toBe(1.3);
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
  });

  test('予測行なし → no-op', async () => {
    predictionRow = null;
    await recordDurationPredictionError(579, 130);
    expect(predictionUpdate).not.toHaveBeenCalled();
  });

  test('実測 null → 参照もせず no-op', async () => {
    await recordDurationPredictionError(579, null);
    expect(predictionFindUnique).not.toHaveBeenCalled();
    expect(predictionUpdate).not.toHaveBeenCalled();
  });

  test('predictable=false の行 → 誤差を記録しない', async () => {
    predictionRow = makePredictionRow({ predictable: false, medianMinutes: null });
    await recordDurationPredictionError(579, 130);
    expect(predictionUpdate).not.toHaveBeenCalled();
  });

  test('median=0 → errorRatio は null（ゼロ除算回避）、errorMinutes は記録', async () => {
    predictionRow = makePredictionRow({ medianMinutes: 0 });
    await recordDurationPredictionError(579, 15);
    const call = predictionUpdate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(call.data.errorMinutes).toBe(15);
    expect(call.data.errorRatio).toBeNull();
  });

  test('update 例外は伝播しない（fail-open）', async () => {
    predictionRow = makePredictionRow();
    predictionUpdate.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    await recordDurationPredictionError(579, 130); // throw しなければ成功
  });
});
