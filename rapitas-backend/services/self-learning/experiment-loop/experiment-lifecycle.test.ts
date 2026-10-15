/**
 * experiment-lifecycle 統合テスト
 *
 * 実験ライフサイクル(生成→計測→判定→採否)と悪化時ロールバックを検証する。
 * 実験状態ストアは一時 RAPITAS_DATA_DIR 上の実ファイルを使い、DB と
 * hypothesis-service は mock。Own file — mock.module is process-global。
 */
import { describe, test, expect, mock, beforeEach, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// DEFAULT_TARGET_N / MIN_SAMPLES は module ロード時に env から確定するため、
// import より前に小さな窓 (targetN=3) を固定してテストを短くする。
process.env.RAPITAS_EXPERIMENT_TARGET_N = '3';
process.env.RAPITAS_EXPERIMENT_MIN_SAMPLES = '3';
const dataDir = mkdtempSync(join(tmpdir(), 'exp-loop-test-'));
process.env.RAPITAS_DATA_DIR = dataDir;

const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {}, fatal: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noop,
  logger: noop,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

interface TaskRow {
  id: number;
  parentId: number | null;
  status: string;
  completedAt: Date;
  updatedAt: Date;
}
interface TransitionRow {
  id: number;
  taskId: number;
  fromStatus: string | null;
  toStatus: string;
  actor: string;
  cause: string;
  phase: string | null;
  metadata: string;
  invariantViolation: boolean;
  createdAt: Date;
}

let tasksDb: TaskRow[] = [];
let transitionsDb: TransitionRow[] = [];
const promptEvolutionCreate = mock((args: { data: Record<string, unknown> }) =>
  Promise.resolve({ id: 1, ...args.data }),
);

mock.module('../../../config/database', () => ({
  prisma: {
    task: {
      findMany: mock((args: { where: { status?: { in: string[] } }; take?: number }) => {
        const statuses = args.where.status?.in ?? [];
        const filtered = tasksDb
          .filter((t) => t.parentId === null && statuses.includes(t.status))
          .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
        return Promise.resolve(
          (args.take ? filtered.slice(0, args.take) : filtered).map((t) => ({ id: t.id })),
        );
      }),
      findUnique: mock((args: { where: { id: number } }) => {
        const t = tasksDb.find((r) => r.id === args.where.id);
        return Promise.resolve(t ? { parentId: t.parentId } : null);
      }),
    },
    workflowTransition: {
      findMany: mock(
        (args: { where: { taskId?: { in: number[] }; actor?: string }; distinct?: string[] }) => {
          const ids = args.where.taskId?.in ?? [];
          let rows = transitionsDb.filter((r) => ids.includes(r.taskId));
          if (args.where.actor) rows = rows.filter((r) => r.actor === args.where.actor);
          if (args.distinct) {
            const seen = new Set<number>();
            const out: Array<{ taskId: number }> = [];
            for (const r of rows) {
              if (seen.has(r.taskId)) continue;
              seen.add(r.taskId);
              out.push({ taskId: r.taskId });
            }
            return Promise.resolve(out);
          }
          return Promise.resolve(
            rows
              .slice()
              .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
              .map(({ ...row }) => row),
          );
        },
      ),
      findFirst: mock((args: { where: { taskId: number; actor: string } }) => {
        const r = transitionsDb.find(
          (t) => t.taskId === args.where.taskId && t.actor === args.where.actor,
        );
        return Promise.resolve(r ? { id: r.id } : null);
      }),
    },
    promptEvolution: { create: promptEvolutionCreate },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

interface HypStub {
  id: number;
  statement: string;
  domain: string;
  status: string;
}
let hypothesis: HypStub | null = null;
const addEvidence = mock(() => Promise.resolve({ ok: true }));
const setHypothesisStatus = mock(() => Promise.resolve(true));
mock.module('../../memory/hypothesis-service', () => ({
  getHypothesis: mock(() => Promise.resolve(hypothesis)),
  addEvidence,
  setHypothesisStatus,
}));

const {
  createExperimentFromHypothesis,
  updateExperimentProgress,
  finalizeExperiment,
  abortExperiment,
} = await import('./experiment-lifecycle');
const {
  readActiveExperiment,
  clearActiveExperiment,
  listExperimentHistory,
  getActiveExperimentAddendum,
} = await import('./experiment-store');

let nextTransitionId = 1;

/** タスク+その遷移行をシードする。clean=false で批評差し戻し1回を含める。 */
function seedTask(id: number, role: string, opts: { clean: boolean; status?: string }): void {
  tasksDb.push({
    id,
    parentId: null,
    status: opts.status ?? 'completed',
    completedAt: new Date(Date.UTC(2026, 0, 1) + id * 60_000),
    updatedAt: new Date(Date.UTC(2026, 0, 1) + id * 60_000),
  });
  const base = new Date(Date.UTC(2026, 0, 1) + id * 60_000).getTime();
  const push = (cause: string, offsetMs: number, actor = role): void => {
    transitionsDb.push({
      id: nextTransitionId++,
      taskId: id,
      fromStatus: 'draft',
      toStatus: 'in_progress',
      actor,
      cause,
      phase: null,
      metadata: '{}',
      invariantViolation: false,
      createdAt: new Date(base + offsetMs),
    });
  };
  push('file_saved:research', 0);
  if (!opts.clean) push('plan_critic_failed', 60_000);
  push('file_saved:verify', 120_000);
}

const HISTORY_FILE = join(dataDir, '.experiment-history.jsonl');

beforeEach(() => {
  tasksDb = [];
  transitionsDb = [];
  nextTransitionId = 1;
  hypothesis = {
    id: 7,
    statement: 'plannerに事前チェックを指示すると批評通過率が上がる',
    domain: 'agent-behavior',
    status: 'open',
  };
  promptEvolutionCreate.mockClear();
  addEvidence.mockClear();
  setHypothesisStatus.mockClear();
  clearActiveExperiment();
  rmSync(HISTORY_FILE, { force: true });
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** control窓3件をシードして実験を開始する(既定: 全件批評差し戻しあり=通過率0)。 */
async function startExperiment(controlClean = false): Promise<void> {
  seedTask(101, 'planner', { clean: controlClean });
  seedTask(102, 'planner', { clean: controlClean });
  seedTask(103, 'planner', { clean: controlClean });
  const res = await createExperimentFromHypothesis(7, 'planner', '- 実装前に既存テストを確認する');
  expect(res.ok).toBe(true);
}

describe('createExperimentFromHypothesis (生成)', () => {
  test('open な agent-behavior 仮説から実験を生成し control 指標を確定する', async () => {
    await startExperiment();
    const active = readActiveExperiment();
    expect(active).not.toBeNull();
    expect(active?.hypothesisId).toBe(7);
    expect(active?.role).toBe('planner');
    expect(active?.targetN).toBe(3);
    expect(active?.controlMetrics.sampleSize).toBe(3);
    expect(active?.controlMetrics.criticPassRate).toBe(0);
    expect(active?.treatmentTaskIds).toEqual([]);
  });

  test('アクティブ実験が既に存在する場合は拒否する(同時実験1本)', async () => {
    await startExperiment();
    const res = await createExperimentFromHypothesis(7, 'planner', '- 別の介入');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('同時実験は1本まで');
  });

  test('domain が agent-behavior 以外の仮説は拒否する', async () => {
    hypothesis = {
      id: 7,
      statement: 'コードベースに関する仮説の主張文',
      domain: 'codebase',
      status: 'open',
    };
    const res = await createExperimentFromHypothesis(7, 'planner', '- 介入');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('agent-behavior');
  });

  test('open 以外の仮説は拒否する', async () => {
    hypothesis = {
      id: 7,
      statement: '既に立証済みの仮説の主張文である',
      domain: 'agent-behavior',
      status: 'supported',
    };
    const res = await createExperimentFromHypothesis(7, 'planner', '- 介入');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('open');
  });

  test('control 窓が最小サンプル数未満なら拒否する', async () => {
    seedTask(101, 'planner', { clean: true });
    seedTask(102, 'planner', { clean: true });
    const res = await createExperimentFromHypothesis(7, 'planner', '- 介入');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('サンプル数が不足');
    expect(readActiveExperiment()).toBeNull();
  });
});

describe('getActiveExperimentAddendum (注入経路)', () => {
  test('対象ロールにのみ介入文を返し、他ロール・実験なしは null', async () => {
    expect(await getActiveExperimentAddendum('planner')).toBeNull();
    await startExperiment();
    expect(await getActiveExperimentAddendum('planner')).toBe('- 実装前に既存テストを確認する');
    expect(await getActiveExperimentAddendum('implementer')).toBeNull();
  });
});

describe('updateExperimentProgress (計測)', () => {
  test('targetN 未達では追記のみで判定しない', async () => {
    await startExperiment();
    seedTask(201, 'planner', { clean: true });
    await updateExperimentProgress(201, 'completed');
    expect(readActiveExperiment()?.treatmentTaskIds).toEqual([201]);
    expect(promptEvolutionCreate).not.toHaveBeenCalled();
  });

  test('completed 以外の終了・対象ロール非関与・重複タスクは追記しない', async () => {
    await startExperiment();
    seedTask(201, 'planner', { clean: true, status: 'blocked' });
    await updateExperimentProgress(201, 'blocked');
    expect(readActiveExperiment()?.treatmentTaskIds).toEqual([]);

    seedTask(202, 'implementer', { clean: true });
    await updateExperimentProgress(202, 'completed');
    expect(readActiveExperiment()?.treatmentTaskIds).toEqual([]);

    seedTask(203, 'planner', { clean: true });
    await updateExperimentProgress(203, 'completed');
    await updateExperimentProgress(203, 'completed');
    expect(readActiveExperiment()?.treatmentTaskIds).toEqual([203]);
  });

  test('targetN 到達で判定が一度だけ走る(N+2件流し込んでも create は1回)', async () => {
    await startExperiment(); // control: 通過率0
    for (const id of [201, 202, 203, 204, 205]) {
      seedTask(id, 'planner', { clean: true }); // treatment: 通過率1 → improved
      await updateExperimentProgress(id, 'completed');
    }
    expect(promptEvolutionCreate).toHaveBeenCalledTimes(1);
    expect(readActiveExperiment()).toBeNull();
  });
});

describe('finalizeExperiment (判定→採否)', () => {
  test('improved: 実証データ付きで PromptEvolution 承認キューへ proposed 投入し仮説を supported にする', async () => {
    await startExperiment(); // control: 通過率0
    for (const id of [201, 202, 203]) {
      seedTask(id, 'planner', { clean: true }); // treatment: 通過率1
      await updateExperimentProgress(id, 'completed');
    }
    expect(promptEvolutionCreate).toHaveBeenCalledTimes(1);
    const data = promptEvolutionCreate.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.status).toBe('proposed');
    expect(data.basePromptKey).toBe('workflow_role_planner');
    expect(data.afterPrompt).toBe('- 実装前に既存テストを確認する');
    const evidence = JSON.parse(String(data.evidenceJson)) as {
      control: { criticPassRate: number; sampleSize: number };
      treatment: { criticPassRate: number; sampleSize: number };
      treatmentTaskIds: number[];
    };
    expect(evidence.control.criticPassRate).toBe(0);
    expect(evidence.treatment.criticPassRate).toBe(1);
    expect(evidence.treatmentTaskIds).toEqual([201, 202, 203]);
    expect(setHypothesisStatus).toHaveBeenCalledWith(7, 'supported');
    expect(addEvidence.mock.calls[0][1].stance).toBe('for');
    expect(readActiveExperiment()).toBeNull();
    expect(listExperimentHistory()[0]?.outcome).toBe('adopted');
  });

  test('regressed: ロールバック(clear)し、承認キューへ投入せず仮説を refuted にする', async () => {
    await startExperiment(true); // control: 通過率1
    for (const id of [201, 202, 203]) {
      seedTask(id, 'planner', { clean: false }); // treatment: 通過率0 → regressed
      await updateExperimentProgress(id, 'completed');
    }
    expect(promptEvolutionCreate).not.toHaveBeenCalled();
    expect(setHypothesisStatus).toHaveBeenCalledWith(7, 'refuted');
    expect(addEvidence.mock.calls[0][1].stance).toBe('against');
    expect(addEvidence.mock.calls[0][1].decisive).toBe(true);
    // ロールバック本体: アクティブ実験が消え、次タスクから注入が消える。
    expect(readActiveExperiment()).toBeNull();
    expect(await getActiveExperimentAddendum('planner')).toBeNull();
    expect(listExperimentHistory()[0]?.outcome).toBe('rejected');
  });

  test('no_diff: 承認キューへ投入せず仮説を inconclusive にする', async () => {
    await startExperiment(true); // control: 通過率1
    for (const id of [201, 202, 203]) {
      seedTask(id, 'planner', { clean: true }); // treatment: 通過率1 → no_diff
      await updateExperimentProgress(id, 'completed');
    }
    expect(promptEvolutionCreate).not.toHaveBeenCalled();
    expect(setHypothesisStatus).toHaveBeenCalledWith(7, 'inconclusive');
    expect(addEvidence.mock.calls[0][1].decisive).toBe(false);
    expect(listExperimentHistory()[0]?.outcome).toBe('inconclusive');
  });

  test('アクティブ実験がなければ null を返し何もしない', async () => {
    expect(await finalizeExperiment()).toBeNull();
    expect(promptEvolutionCreate).not.toHaveBeenCalled();
  });
});

describe('abortExperiment (手動中断)', () => {
  test('アクティブ実験を判定なしで中断し履歴に aborted を残す', async () => {
    await startExperiment();
    expect(abortExperiment()).toBe(true);
    expect(readActiveExperiment()).toBeNull();
    expect(setHypothesisStatus).not.toHaveBeenCalled();
    expect(listExperimentHistory()[0]?.outcome).toBe('aborted');
    expect(abortExperiment()).toBe(false);
  });
});
