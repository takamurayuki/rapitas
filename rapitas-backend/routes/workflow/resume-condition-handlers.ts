/**
 * resume-condition-handlers
 *
 * Request handlers for the blocked-task resume-condition flow: fetch the one
 * question, preview the typed condition (no writes), approve it (human only).
 * Business rules live in services/workflow/resume-condition; NOT responsible
 * for route registration.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  RESUME_CONDITION_TTL_MS,
  approveCondition,
  buildQuestionId,
  buildResumeQuestion,
  findSuggestion,
  isResumableReason,
  loadConditionState,
  loadResumeRows,
  loadStopMarkerId,
  loadStopReason,
  parseResumeAnswer,
  type ResumableReason,
  type ResumeConditionSpec,
} from '../../services/workflow/resume-condition';

const log = createLogger('routes:resume-condition');

/** Callers allowed to approve — same set as approve-plan / release-halt. */
const APPROVE_SOURCES = new Set(['ui', 'operator']);

type Db = typeof prisma;

/** Injectable collaborators (tests stub all three). */
export interface ResumeDeps {
  db: Db;
  now: () => number;
  fileExists: (relPath: string, baseDir: string | undefined) => boolean;
}

/** Default deps: real DB and clock; files resolved under the task's working dir. */
export const defaultResumeDeps: ResumeDeps = {
  db: prisma,
  now: () => Date.now(),
  fileExists: (relPath, baseDir) => {
    const base = resolve(baseDir ?? process.cwd());
    const abs = resolve(base, relPath);
    const rel = relative(base, abs);
    // Defense in depth: parseResumeAnswer already rejects '..', but never trust one layer.
    return !rel.startsWith('..') && !isAbsolute(rel) && existsSync(abs);
  },
};

/** Minimal Elysia context shape the handlers use. */
export interface ResumeCtx {
  params: { taskId: string };
  body?: unknown;
  headers?: Record<string, string | undefined>;
  set: { status?: number | string };
}

interface Prepared {
  task: { id: number; status: string; workflowStatus: string | null };
  reason: ResumableReason;
  spec: ResumeConditionSpec;
  questionId: string;
  stopMarkerId: number;
}

type PrepareResult = { ok: true; value: Prepared } | { ok: false; status: number; error: string };

async function loadTask(db: Db, taskId: number) {
  return db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      workflowStatus: true,
      workingDirectory: true,
      theme: { select: { workingDirectory: true } },
    },
  });
}

async function prepare(ctx: ResumeCtx, deps: ResumeDeps): Promise<PrepareResult> {
  const taskId = parseInt(ctx.params.taskId, 10);
  if (!Number.isFinite(taskId)) return { ok: false, status: 400, error: 'invalid taskId' };
  const task = await loadTask(deps.db, taskId);
  if (!task) return { ok: false, status: 404, error: 'task not found' };
  if (task.status !== 'blocked') return { ok: false, status: 409, error: 'task is not blocked' };

  const reason = await loadStopReason(deps.db, taskId);
  const q = reason ? buildResumeQuestion(reason) : null;
  if (!reason || !q || q.kind !== 'question' || !isResumableReason(reason)) {
    return { ok: false, status: 422, error: 'this stop reason cannot be released by a condition' };
  }
  const stopMarkerId = await loadStopMarkerId(deps.db, taskId);
  const questionId = buildQuestionId(taskId, reason, stopMarkerId);
  const body = (ctx.body ?? {}) as { questionId?: unknown; answer?: unknown };
  if (body.questionId !== questionId) {
    return { ok: false, status: 409, error: 'questionId is stale or unknown' };
  }
  const baseDir = task.workingDirectory ?? task.theme?.workingDirectory ?? undefined;
  const parsed = parseResumeAnswer(reason, body.answer, (p) => deps.fileExists(p, baseDir));
  if (!parsed.ok) return { ok: false, status: 422, error: parsed.error };
  return {
    ok: true,
    value: {
      task: { id: task.id, status: task.status, workflowStatus: task.workflowStatus },
      reason,
      spec: parsed.spec,
      questionId,
      stopMarkerId,
    },
  };
}

/**
 * GET /workflow/tasks/:taskId/resume-question
 *
 * @param ctx - Route context. / ルート情報
 * @param deps - Collaborators. / 依存
 * @returns question / not_resumable / active / none state. / 質問状態
 */
export async function handleGetResumeQuestion(
  ctx: ResumeCtx,
  deps: ResumeDeps = defaultResumeDeps,
) {
  const taskId = parseInt(ctx.params.taskId, 10);
  if (!Number.isFinite(taskId)) {
    ctx.set.status = 400;
    return { success: false as const, error: 'invalid taskId' };
  }
  const task = await loadTask(deps.db, taskId);
  if (!task) {
    ctx.set.status = 404;
    return { success: false as const, error: 'task not found' };
  }
  const evaluated = await loadConditionState(deps.db, task, deps.now());
  if (evaluated.state === 'active') {
    return { success: true as const, state: 'active' as const, condition: evaluated.condition };
  }
  const reason = task.status === 'blocked' ? await loadStopReason(deps.db, taskId) : null;
  if (!reason) return { success: true as const, state: 'none' as const };
  const q = buildResumeQuestion(reason);
  if (q.kind !== 'question') {
    return { success: true as const, state: 'not_resumable' as const, reason };
  }
  const questionId = buildQuestionId(taskId, reason, await loadStopMarkerId(deps.db, taskId));
  const rows = await loadResumeRows(deps.db, taskId);
  return {
    success: true as const,
    state: 'question' as const,
    questionId,
    question: q,
    // A recurrence of the same reason: the user may approve the earlier answer instead of retyping it.
    suggestion: findSuggestion(rows, q.reason, questionId),
  };
}

/**
 * POST .../resume-condition/preview — converts the answer and shows what would
 * be registered. Writes NOTHING.
 *
 * @param ctx - Route context. / ルート情報
 * @param deps - Collaborators. / 依存
 * @returns Typed condition preview or an error. / プレビュー
 */
export async function handlePreviewResumeCondition(
  ctx: ResumeCtx,
  deps: ResumeDeps = defaultResumeDeps,
) {
  const r = await prepare(ctx, deps);
  if (!r.ok) {
    ctx.set.status = r.status;
    return { success: false as const, error: r.error };
  }
  const { value } = r;
  return {
    success: true as const,
    preview: {
      questionId: value.questionId,
      reason: value.reason,
      spec: value.spec,
      expiresAt: deps.now() + RESUME_CONDITION_TTL_MS,
      effect: `承認すると、次回の自動再試行判定で停止理由 ${value.reason} の除外が1回だけ解除されます（24時間で失効）。`,
    },
  };
}

/**
 * POST .../resume-condition/approve — human-only. Re-parses the answer (the
 * client's preview is not trusted) and stores the 24h condition. Idempotent.
 *
 * @param ctx - Route context. / ルート情報
 * @param deps - Collaborators. / 依存
 * @returns Stored condition or an error. / 保存結果
 */
export async function handleApproveResumeCondition(
  ctx: ResumeCtx,
  deps: ResumeDeps = defaultResumeDeps,
) {
  const source = (ctx.headers?.['x-rapitas-source'] ?? '').toLowerCase();
  if (!APPROVE_SOURCES.has(source)) {
    ctx.set.status = 403;
    return { success: false as const, error: 'X-Rapitas-Source (ui|operator) header is required' };
  }
  const r = await prepare(ctx, deps);
  if (!r.ok) {
    ctx.set.status = r.status;
    return { success: false as const, error: r.error };
  }
  const { value } = r;
  const nowMs = deps.now();
  try {
    const existing = await loadConditionState(deps.db, value.task, nowMs);
    if (existing.state === 'active' && existing.condition.questionId === value.questionId) {
      return { success: true as const, condition: existing.condition };
    }
    const condition = await approveCondition(deps.db, {
      task: value.task,
      questionId: value.questionId,
      reason: value.reason,
      spec: value.spec,
      stopMarkerId: value.stopMarkerId,
      nowMs,
      source,
    });
    return { success: true as const, condition };
  } catch (err) {
    log.error({ err, taskId: value.task.id }, '[resume-condition] approve failed');
    ctx.set.status = 500;
    return { success: false as const, error: 'failed to store the condition' };
  }
}
