/**
 * deviation-deps
 *
 * Data-access contract for the plan-deviation handlers and its production
 * implementation (Prisma + file stores). Prisma is imported lazily so test
 * code that injects fakes never opens a database client.
 */
import {
  appendDeviationAudit,
  getOperationStore,
  type DeviationAuditRecord,
  type LogContextSource,
  type OperationRecord,
} from '../../../services/workflow/plan-deviation';

/** How many recent executions are scanned for recorded operations. */
const RECENT_EXECUTION_SCAN = 20;

/** Execution fields the timeline needs. */
export interface ExecutionInfo {
  id: number;
  status: string;
  agentType: string | null;
  worktreePath: string | null;
  /** When the run started (falls back to its creation); picks the plan in force. */
  startedAt?: Date | null;
}

/** One version of plan.md and until when it was the plan in force. */
export interface PlanVersion {
  content: string;
  /** When a newer version replaced it; null for the current plan. */
  validUntil: Date | null;
}

/** Injected data access. */
export interface DeviationDeps {
  readPlan(taskId: number): Promise<string | null>;
  /**
   * Every plan.md version, oldest first, the current one last. Optional: when
   * absent the current plan is used for every run.
   */
  readPlanVersions?(taskId: number): Promise<PlanVersion[]>;
  /** Executions of the task, newest first (only `executionId` when given). */
  findExecutions(taskId: number, executionId?: number): Promise<ExecutionInfo[]>;
  readOperations(executionId: number): { operations: OperationRecord[]; warnings: string[] };
  logSource(executionId: number): LogContextSource;
  appendAudit(record: DeviationAuditRecord): void;
}

/**
 * Prisma-backed dependencies used in production.
 *
 * @returns Default deps (Prisma + file stores) / 本番用の依存
 */
export function createDefaultDeviationDeps(): DeviationDeps {
  const db = async () => (await import('../../../config')).prisma;
  return {
    async readPlan(taskId) {
      const { readWorkflowFile } = await import('../../../services/workflow/workflow-file-utils');
      return readWorkflowFile(taskId, 'plan');
    },
    async readPlanVersions(taskId) {
      const prisma = await db();
      // NOTE: A WorkflowFileVersion row is a plan that was replaced at archivedAt,
      // so it was the plan in force until then (audit 2026-11-17, task 1410).
      const [archived, current] = await Promise.all([
        prisma.workflowFileVersion.findMany({
          where: { taskId, fileType: 'plan' },
          orderBy: { archivedAt: 'asc' },
          select: { content: true, archivedAt: true },
        }),
        this.readPlan(taskId),
      ]);
      return [
        ...archived.map((v) => ({ content: v.content, validUntil: v.archivedAt })),
        ...(current !== null ? [{ content: current, validUntil: null }] : []),
      ];
    },
    async findExecutions(taskId, executionId) {
      const prisma = await db();
      const rows = await prisma.agentExecution.findMany({
        where: {
          session: { config: { taskId } },
          ...(executionId !== undefined ? { id: executionId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: executionId !== undefined ? 1 : RECENT_EXECUTION_SCAN,
        select: {
          id: true,
          status: true,
          startedAt: true,
          createdAt: true,
          agentConfig: { select: { agentType: true } },
          session: { select: { worktreePath: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        agentType: r.agentConfig?.agentType ?? null,
        worktreePath: r.session?.worktreePath ?? null,
        startedAt: r.startedAt ?? r.createdAt,
      }));
    },
    readOperations: (executionId) => getOperationStore().readOperations(executionId),
    logSource(executionId) {
      return {
        async getBounds() {
          const prisma = await db();
          const agg = await prisma.agentExecutionLog.aggregate({
            where: { executionId },
            _min: { sequenceNumber: true },
            _max: { sequenceNumber: true },
          });
          const min = agg._min.sequenceNumber;
          const max = agg._max.sequenceNumber;
          return min === null || max === null ? null : { min, max };
        },
        async getRange(from, to) {
          const prisma = await db();
          return prisma.agentExecutionLog.findMany({
            where: { executionId, sequenceNumber: { gte: from, lte: to } },
            orderBy: { sequenceNumber: 'asc' },
            select: { sequenceNumber: true, logChunk: true },
          });
        },
      };
    },
    appendAudit: (record) => appendDeviationAudit(record),
  };
}
