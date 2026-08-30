/**
 * predictive-task-suggester テスト
 *
 * getSuggestedTasks の calculateTaskScore 分岐（優先度加重・期限切迫・進行中ボーナス・
 * ポモドーロ実績ボーナス）と、同点スコア時の taskId 昇順タイブレークによる決定的な並び
 * を検証する。getProductivityHeatmap の peakHours/lowHours も同様に「件数降順・時刻昇順」
 * のタイブレークが安定することを検証する。Bun.setSystemTime で現在時刻を固定し、
 * calculateTaskScore の時間帯ボーナス（6-11時/17時以降）が結果を汚染しないようにする。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

interface TaskRow {
  id: number;
  priority: string;
  dueDate: Date | null;
  themeId: number | null;
  estimatedHours: number | null;
  status: string;
  updatedAt: Date;
  title: string;
  theme: { id: number; name: string } | null;
  taskLabels: unknown[];
  pomodoroSessions: Array<{ id: number }>;
  completedAt: Date | null;
}

let taskRows: TaskRow[] = [];
let userBehaviors: Array<{
  actionType: string;
  createdAt: Date;
  taskId: number | null;
  metadata: unknown;
}> = [];

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findMany: () => Promise.resolve(taskRows),
    },
    userBehavior: {
      findMany: () => Promise.resolve(userBehaviors),
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { getSuggestedTasks, getProductivityHeatmap } =
  await import('../../services/ai/predictive-task-suggester');

function task(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: 1,
    priority: 'medium',
    dueDate: null,
    themeId: null,
    estimatedHours: null,
    status: 'todo',
    updatedAt: new Date('2024-03-01'),
    title: 'T',
    theme: null,
    taskLabels: [],
    pomodoroSessions: [],
    completedAt: null,
    ...overrides,
  };
}

// 2024-03-15 14:30 (Fri) — hour=14 is outside both the 6-11 and >=17 time-of-day
// bonus windows in calculateTaskScore, so that branch contributes 0 uniformly
// and does not perturb the priority/due-date/status assertions below.
//
// NOTE: This Bun build has no Bun.setSystemTime, so `new Date()`/`Date.now()`
// are frozen by swapping the global Date constructor for a subclass that
// pins the no-arg/now() paths while delegating explicit-arg construction
// (e.g. `new Date(dueDate)`) to the real Date — required for deterministic
// hourOfDay/dayOfWeek and due-date-delta assertions below.
const FIXED_NOW = new Date('2024-03-15T14:30:00');
const RealDate = Date;

class FixedDate extends RealDate {
  constructor(...args: unknown[]) {
    // NOTE: `Date`'s constructor is an overloaded union (0/1/2..7 args) — casting
    // the merged array once avoids fighting TS's per-overload tuple narrowing
    // while still delegating explicit-arg construction to the real Date at runtime.
    super(
      ...((args.length === 0 ? [FIXED_NOW.getTime()] : args) as ConstructorParameters<typeof Date>),
    );
  }
  static override now(): number {
    return FIXED_NOW.getTime();
  }
}

beforeEach(() => {
  taskRows = [];
  userBehaviors = [];
  globalThis.Date = FixedDate as unknown as DateConstructor;
});

afterEach(() => {
  globalThis.Date = RealDate;
});

describe('getSuggestedTasks — 未完了タスクが無い場合', () => {
  test('空配列 + 専用メッセージを返す', async () => {
    taskRows = [];
    const result = await getSuggestedTasks();
    expect(result.suggestions).toEqual([]);
    expect(result.message).toBe('未完了のタスクがありません');
  });
});

describe('getSuggestedTasks — 優先度加重 (base 50 + priorityScores)', () => {
  test('urgent(75) > high(65) > medium(55) > low(50) の順にスコアが並ぶ', async () => {
    taskRows = [
      task({ id: 1, priority: 'low' }),
      task({ id: 2, priority: 'medium' }),
      task({ id: 3, priority: 'high' }),
      task({ id: 4, priority: 'urgent' }),
    ];
    const result = await getSuggestedTasks();
    const byId = new Map(result.suggestions.map((s) => [s.taskId, s.score]));
    expect(byId.get(4)).toBe(75);
    expect(byId.get(3)).toBe(65);
    expect(byId.get(2)).toBe(55);
    expect(byId.get(1)).toBe(50);
    // sorted descending by score
    expect(result.suggestions.map((s) => s.taskId)).toEqual([4, 3, 2, 1]);
  });
});

describe('getSuggestedTasks — 同点スコアの決定的タイブレーク（taskId 昇順）', () => {
  test('スコアが完全に同一なら taskId 昇順で並ぶ', async () => {
    taskRows = [
      task({ id: 9, priority: 'medium' }),
      task({ id: 3, priority: 'medium' }),
      task({ id: 5, priority: 'medium' }),
    ];
    const result = await getSuggestedTasks();
    expect(result.suggestions.every((s) => s.score === 55)).toBe(true);
    expect(result.suggestions.map((s) => s.taskId)).toEqual([3, 5, 9]);
  });
});

describe('getSuggestedTasks — 期限切迫ボーナス', () => {
  test('期限超過 → +30、reasons に「期限超過」', async () => {
    const past = new Date(FIXED_NOW.getTime() - 24 * 60 * 60 * 1000);
    taskRows = [task({ id: 1, priority: 'low', dueDate: past })];
    const result = await getSuggestedTasks();
    expect(result.suggestions[0].score).toBe(80); // 50 + 30
    expect(result.suggestions[0].reasons).toContain('期限超過');
  });

  test('本日中（<1日）→ +25', async () => {
    const soon = new Date(FIXED_NOW.getTime() + 12 * 60 * 60 * 1000);
    taskRows = [task({ id: 1, priority: 'low', dueDate: soon })];
    const result = await getSuggestedTasks();
    expect(result.suggestions[0].score).toBe(75); // 50 + 25
    expect(result.suggestions[0].reasons).toContain('本日が期限');
  });

  test('3日以内 → +15', async () => {
    const near = new Date(FIXED_NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    taskRows = [task({ id: 1, priority: 'low', dueDate: near })];
    const result = await getSuggestedTasks();
    expect(result.suggestions[0].score).toBe(65); // 50 + 15
    expect(result.suggestions[0].reasons).toContain('期限が近い');
  });

  test('期限なし → ボーナス無し', async () => {
    taskRows = [task({ id: 1, priority: 'low', dueDate: null })];
    const result = await getSuggestedTasks();
    expect(result.suggestions[0].score).toBe(50);
  });
});

describe('getSuggestedTasks — 進行中ボーナス / ポモドーロ実績ボーナス', () => {
  test('in-progress タスクは +20', async () => {
    taskRows = [task({ id: 1, priority: 'low', status: 'in-progress' })];
    const result = await getSuggestedTasks();
    expect(result.suggestions[0].score).toBe(70); // 50 + 20
    expect(result.suggestions[0].reasons).toContain('進行中のタスク（切替コスト低）');
  });

  test('ポモドーロ実績があれば +5', async () => {
    taskRows = [task({ id: 1, priority: 'low', pomodoroSessions: [{ id: 1 }, { id: 2 }] })];
    const result = await getSuggestedTasks();
    expect(result.suggestions[0].score).toBe(55); // 50 + 5
    expect(result.suggestions[0].reasons[0]).toContain('ポモドーロ2回実績あり');
  });
});

describe('getSuggestedTasks — limit', () => {
  test('limit で上位N件のみ返す', async () => {
    taskRows = [
      task({ id: 1, priority: 'urgent' }),
      task({ id: 2, priority: 'high' }),
      task({ id: 3, priority: 'low' }),
    ];
    const result = await getSuggestedTasks(2);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions.map((s) => s.taskId)).toEqual([1, 2]);
  });
});

describe('getSuggestedTasks — scope パラメータ', () => {
  test('scope 未指定は従来どおり全件を対象にする（completedAt があっても除外しない）', async () => {
    taskRows = [
      task({ id: 1, priority: 'low' }),
      task({ id: 2, priority: 'low', completedAt: new Date('2024-03-10') }),
    ];
    const result = await getSuggestedTasks(5);
    expect(result.suggestions.map((s) => s.taskId).sort()).toEqual([1, 2]);
  });

  test('scope="today" は completedAt が非nullのタスクを除外する', async () => {
    taskRows = [
      task({ id: 1, priority: 'low' }),
      task({ id: 2, priority: 'low', completedAt: new Date('2024-03-10') }),
    ];
    const result = await getSuggestedTasks(5, 'today');
    expect(result.suggestions.map((s) => s.taskId)).toEqual([1]);
  });

  test('scope="today" でも未完了タスクのみなら件数は変わらない', async () => {
    taskRows = [task({ id: 1, priority: 'low' }), task({ id: 2, priority: 'medium' })];
    const result = await getSuggestedTasks(5, 'today');
    expect(result.suggestions).toHaveLength(2);
  });

  test('scope="all" は明示指定でも従来どおり completedAt で絞り込まない', async () => {
    taskRows = [task({ id: 1, priority: 'low', completedAt: new Date('2024-03-10') })];
    const result = await getSuggestedTasks(5, 'all');
    expect(result.suggestions.map((s) => s.taskId)).toEqual([1]);
  });
});

describe('getProductivityHeatmap — peakHours/lowHours の決定的タイブレーク', () => {
  test('件数同点は時刻昇順、0件同士も時刻昇順で安定する', async () => {
    // hour=3 と hour=7 に各2件、他は0件。
    const mk = (hour: number) => {
      const d = new Date(FIXED_NOW);
      d.setHours(hour, 0, 0, 0);
      return { actionType: 'task_completed', createdAt: d, taskId: 1, metadata: null };
    };
    userBehaviors = [mk(3), mk(3), mk(7), mk(7)];

    const result = await getProductivityHeatmap(90);

    // Top counts (2,2) tie-broken ascending by hour → 3 then 7; third slot is
    // the first zero-count hour in ascending order (0).
    expect(result.peakHours).toEqual([3, 7, 0]);
    // Zero-count hours sorted ascending by hour → the last three are the
    // largest hour values among the zero group (3 and 7 are excluded early).
    expect(result.lowHours).toEqual([21, 22, 23]);
  });

  test('全時間帯0件のときは lowHours が空配列にならない（0件が大半のケース）', async () => {
    userBehaviors = [];
    const result = await getProductivityHeatmap(90);
    expect(result.peakHours).toEqual([0, 1, 2]); // all zero, ascending tie-break
    expect(result.lowHours).toEqual([21, 22, 23]);
  });
});
