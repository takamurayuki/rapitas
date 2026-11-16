/**
 * routing-acceptance-flow.test-helpers
 *
 * Test-only DB rows and readers for acceptance test H: seeds a task whose
 * implementer and verifier phases already ran (real AgentSession /
 * AgentExecution rows with the models they reported), builds the server's
 * completion review receipt for its verify.md, and reads back what the real
 * pipeline recorded (task status, transitions, decision traces, the jury's
 * timeline event). Not responsible for running the pipeline (the pattern
 * files import it, since it lives under routes/).
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../../generated/prisma-sqlite';
import type { PrismaClient as PostgresClient } from '../../../generated/prisma-postgres';
import type { CompletionReviewReceipt } from '../requirement-replan-commit';

/** What the task's phases ran on. */
export interface SeedOptions {
  /** Implementer runs' reported models, oldest first (null = not reported). */
  executorModels: Array<string | null>;
  /** Verifier phase's reported model. */
  verifierModel: string | null;
  /** Agent type of the implementer config. */
  agentType?: 'claude-code' | 'codex';
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

const PLAN = '## 実装チェックリスト\n- [x] src/a.ts に a を足す';
const VERIFY = '## 全体判定\n✅ 合格\n\n## テスト\n- unit: 3 pass / 0 fail';

/**
 * Insert a task at verify_done with its implementer and verifier runs.
 *
 * @param db - SQLite client / DB
 * @param opts - Models the phases reported / 各フェーズのモデル
 * @returns Task id / タスクID
 */
export async function seedVerifiedTask(db: PrismaClient, opts: SeedOptions): Promise<number> {
  const task = await db.task.create({
    data: {
      title: 'ログイン画面の検証を足す',
      description: 'src/a.ts に a を足す',
      acceptanceCriteria: JSON.stringify(['a が export される']),
      status: 'in-progress',
      workflowStatus: 'verify_done',
      workflowMode: 'lightweight',
    },
  });
  await db.workflowFile.createMany({
    data: [
      {
        taskId: task.id,
        fileType: 'plan',
        content: PLAN,
        sha256: sha256(PLAN),
        sizeBytes: Buffer.byteLength(PLAN),
      },
      {
        taskId: task.id,
        fileType: 'verify',
        content: VERIFY,
        sha256: sha256(VERIFY),
        sizeBytes: Buffer.byteLength(VERIFY),
      },
    ],
  });
  const config = await db.developerModeConfig.create({ data: { taskId: task.id } });
  const agent = await agentConfig(db, opts.agentType ?? 'claude-code');
  const implementer = await db.agentSession.create({
    data: { configId: config.id, mode: 'workflow-implementer', worktreePath: '/wt/task' },
  });
  let t = Date.UTC(2026, 10, 11, 1, 0, 0);
  for (const modelName of opts.executorModels) {
    await db.agentExecution.create({
      data: {
        sessionId: implementer.id,
        agentConfigId: agent.id,
        command: 'execute',
        status: modelName ? 'completed' : 'failed',
        modelName,
        startedAt: new Date(t),
        createdAt: new Date(t),
      },
    });
    t += 60_000;
  }
  const verifier = await db.agentSession.create({
    data: { configId: config.id, mode: 'workflow-verifier', worktreePath: '/wt/task' },
  });
  await db.agentExecution.create({
    data: {
      sessionId: verifier.id,
      agentConfigId: agent.id,
      command: 'execute',
      status: 'completed',
      modelName: opts.verifierModel,
      startedAt: new Date(t),
      createdAt: new Date(t),
    },
  });
  return task.id;
}

/**
 * The (single) active agent config of a type, created on first use.
 *
 * @param db - SQLite client / DB
 * @param agentType - Agent type / エージェント種別
 * @returns The config row / 設定行
 */
export async function agentConfig(db: PrismaClient, agentType: 'claude-code' | 'codex') {
  return (
    (await db.aIAgentConfig.findFirst({ where: { agentType } })) ??
    (await db.aIAgentConfig.create({ data: { agentType, name: agentType, isActive: true } }))
  );
}

/**
 * The receipt status-transition.ts would hold after a passing replan review
 * of this verify.md (no mismatch), computed with the production digest.
 *
 * @param db - SQLite client / DB
 * @param taskId - Task id / タスクID
 * @returns Completion receipt / 完了の受領票
 */
export async function receiptFor(
  db: PrismaClient,
  taskId: number,
): Promise<CompletionReviewReceipt> {
  const { replanSnapshotDigest } = await import('../requirement-replan-evidence');
  const { readReviewedPlanPolicy } = await import('../reviewed-plan-policy');
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  const files = await db.workflowFile.findMany({ where: { taskId } });
  const content = (t: string) => files.find((f) => f.fileType === t)?.content ?? '';
  const planPolicy = await readReviewedPlanPolicy(
    db as unknown as Parameters<typeof readReviewedPlanPolicy>[0],
    task.workflowMode ?? 'comprehensive',
  );
  const digest = replanSnapshotDigest({
    title: task.title,
    description: task.description ?? '',
    goals: JSON.parse(task.goals ?? '[]'),
    constraints: JSON.parse(task.constraints ?? '[]'),
    acceptanceCriteria: JSON.parse(task.acceptanceCriteria ?? '[]'),
    planPolicy,
    plan: content('plan'),
    verify: content('verify'),
  });
  const latest = await db.agentExecution.findFirst({
    where: { session: { config: { taskId } }, command: { not: 'adversarial-review' } },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  return {
    taskId,
    executionId: latest?.id ?? null,
    evaluatedUpdatedAt: task.updatedAt,
    review: {
      verdict: { kind: 'no_mismatch', reason: 'matches' },
      snapshotDigest: digest,
      durationMs: 1,
      tokensUsed: 1,
      modelName: null,
    } as CompletionReviewReceipt['review'],
  };
}

/** Everything the pipeline left behind for one task. */
export interface Outcome {
  status: string | null;
  workflowStatus: string | null;
  transitions: Array<{ cause: string; toStatus: string; metadata: Record<string, unknown> }>;
  decisions: Array<{
    summary: string;
    adoptedReason: string | null;
    input: Record<string, unknown>;
  }>;
  review: {
    seating?: {
      mode: string;
      seats: Array<{ seatId: string; model: string; independence: string; requiredTier: string }>;
      shortfalls: Array<{ seatId: string; reason: string }>;
      unavailable: Array<{ vendor: string; reason: string; resumeAt?: string }>;
    };
    jurors: Array<{ seatId?: string; verdict: string; unknownReason?: string }>;
    /** Seats as asked (provider and model id of each call). */
    seats: Array<{ seatId: string; provider: string; model: string }>;
  } | null;
}

const parse = (v: unknown): Record<string, unknown> => {
  if (typeof v !== 'string') return (v as Record<string, unknown>) ?? {};
  try {
    return JSON.parse(v) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/**
 * Read what the pipeline recorded for a task.
 *
 * @param db - SQLite client / DB
 * @param taskId - Task id / タスクID
 * @param recorded - Decision traces captured by the harness / 記録された判断
 * @returns Status, transitions, decision traces and the last review event / 記録一式
 */
export async function readOutcome(
  db: PrismaClient,
  taskId: number,
  recorded: Array<{
    taskId?: number;
    summary: string;
    adoptedReason?: string;
    input?: Record<string, unknown>;
  }> = [],
): Promise<Outcome> {
  // Decision traces and the cost row are fire-and-forget writes.
  await new Promise((r) => setTimeout(r, 30));
  const task = await db.task.findUnique({ where: { id: taskId } });
  const transitions = await db.workflowTransition.findMany({
    where: { taskId },
    orderBy: { id: 'asc' },
  });
  const events = await db.timelineEvent.findMany({
    where: { eventType: 'adversarial_review' },
    orderBy: { id: 'asc' },
  });
  const mine = events.filter((e) => parse(e.payload).taskId === taskId);
  const last = mine[mine.length - 1];
  return {
    status: task?.status ?? null,
    workflowStatus: task?.workflowStatus ?? null,
    transitions: transitions.map((t) => ({
      cause: t.cause ?? '',
      toStatus: t.toStatus,
      metadata: parse(t.metadata),
    })),
    decisions: recorded
      .filter((d) => d.taskId === taskId)
      .map((d) => ({
        summary: d.summary,
        adoptedReason: d.adoptedReason ?? null,
        input: d.input ?? {},
      })),
    review: last ? (parse(last.payload) as Outcome['review']) : null,
  };
}

/**
 * Run the real post-save automation for a task's passing verify.md.
 *
 * @param run - runVerifyPostSaveAutomation, imported by the pattern file / パイプライン本体
 * @param db - SQLite client / DB
 * @param taskId - Task id / タスクID
 * @returns The pipeline's own outcome / パイプラインの結果
 */
export async function runPostSave<T>(
  run: (p: {
    completionReceipt?: CompletionReviewReceipt;
    taskId: number;
    fileType: 'verify';
    newStatus: string;
    savedContent: string;
  }) => Promise<T>,
  db: PrismaClient,
  taskId: number,
): Promise<T> {
  const verify = await db.workflowFile.findFirstOrThrow({ where: { taskId, fileType: 'verify' } });
  return run({
    completionReceipt: await receiptFor(db, taskId),
    taskId,
    fileType: 'verify',
    newStatus: 'verify_done',
    savedContent: verify.content,
  });
}

/** The Postgres-typed view of the SQLite client production code expects. */
export const asPostgres = (db: PrismaClient) => db as unknown as PostgresClient;
