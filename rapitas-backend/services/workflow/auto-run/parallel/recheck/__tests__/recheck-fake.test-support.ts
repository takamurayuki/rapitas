/**
 * recheck-fake.test-support
 *
 * In-memory world for the task-1572 re-check gate tests: WorkflowTransition
 * rows, tasks (description / workflowMode), plan and research artifacts and
 * each theme's running set, plus the gate deps built over them. The real
 * pair rules (buildParallelFilter → judgePair) run unchanged. Test-only.
 */
import type { RecheckGateDeps } from '../recheck-gate';
import type { ThemeActiveSet } from '../../parallel-types';
import type { PeerActiveTask } from '../../repository-peers';

export interface TransitionRow {
  id: number;
  taskId: number;
  cause: string;
  fromStatus: string | null;
  toStatus: string;
  createdAt: Date;
  metadata: string;
}

export interface World {
  clock: number;
  transitions: TransitionRow[];
  tasks: Record<number, { description?: string | null; workflowMode?: string | null }>;
  plans: Record<number, string | null>;
  research: Record<number, string | null>;
  sets: Record<number, ThemeActiveSet>;
  peers: Record<number, PeerActiveTask[]>;
  createFails: boolean;
  markReadFails: boolean;
  /** Rejects the held-signature read (findFirst). */
  heldReadFails: boolean;
  setReads: number;
}

export const plan = (...files: string[]) => files.map((f) => `- \`${f}\``).join('\n');

/** A fresh world with nothing running. */
export function newWorld(): World {
  return {
    clock: 10_000,
    transitions: [],
    tasks: {},
    plans: {},
    research: {},
    sets: {},
    peers: {},
    createFails: false,
    markReadFails: false,
    heldReadFails: false,
    setReads: 0,
  };
}

/** Running set of a theme: head plus companions. */
export function runningSet(head: number | null, ...companions: number[]): ThemeActiveSet {
  return {
    headTaskId: head,
    companions: companions.map((taskId) => ({ taskId, since: 1 })),
    raw: null,
    readable: true,
  };
}

/** Add a pending mark for `taskId` at `at` (ms). */
export function mark(w: World, taskId: number, at: number): void {
  w.transitions.push({
    id: w.transitions.length + 1,
    taskId,
    cause: 'parallel_recheck_pending',
    fromStatus: 'draft',
    toStatus: 'draft',
    createdAt: new Date(at),
    metadata: '{}',
  });
}

type Where = { taskId: number; cause?: string | { in: string[] }; createdAt?: { gte: Date } };

function rowsFor(w: World, where: Where): TransitionRow[] {
  return w.transitions
    .filter((r) => r.taskId === where.taskId)
    .filter((r) =>
      typeof where.cause === 'string'
        ? r.cause === where.cause
        : where.cause
          ? where.cause.in.includes(r.cause)
          : true,
    )
    .filter((r) => !where.createdAt || r.createdAt.getTime() >= where.createdAt.gte.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
}

/** Fake Prisma client over the world. */
export function fakePrisma(w: World) {
  return {
    workflowTransition: {
      create: async (a: { data: Omit<TransitionRow, 'id' | 'createdAt'> }) => {
        if (w.createFails) throw new Error('db down');
        w.transitions.push({
          ...a.data,
          id: w.transitions.length + 1,
          createdAt: new Date(w.clock),
        });
        return {};
      },
      findMany: async (a: { where: Where }) => {
        if (w.markReadFails) throw new Error('read failed');
        return rowsFor(w, a.where).slice(0, 1);
      },
      findFirst: async (a: { where: Where }) => {
        if (w.heldReadFails) throw new Error('read failed');
        return rowsFor(w, a.where)[0] ?? null;
      },
    },
    task: {
      findUnique: async (a: { where: { id: number } }) => {
        const t = w.tasks[a.where.id] ?? {};
        return {
          id: a.where.id,
          description: t.description ?? null,
          workflowStatus: 'plan_approved',
          workflowMode: t.workflowMode ?? null,
        };
      },
      findMany: async () => [],
    },
    taskDependency: { findFirst: async () => null },
  };
}

/** Gate deps over the world; the pair judge is the real one. */
export function gateDeps(w: World): Partial<RecheckGateDeps> {
  const prisma = fakePrisma(w);
  return {
    getPrisma: async () => prisma,
    readActiveSet: async (_p, themeId) => {
      w.setReads++;
      return w.sets[themeId] ?? { headTaskId: null, companions: [], raw: null, readable: true };
    },
    loadPeers: async (_p, themeId) => w.peers[themeId] ?? [],
    readMode: async (_p, taskId) => w.tasks[taskId]?.workflowMode ?? null,
    readArtifact: async (taskId, type) =>
      (type === 'plan' ? w.plans[taskId] : w.research[taskId]) ?? null,
    now: () => w.clock,
  };
}

/** Rows of a cause for a task. */
export function rowsOf(w: World, taskId: number, cause: string): TransitionRow[] {
  return w.transitions.filter((r) => r.taskId === taskId && r.cause === cause);
}

export const IMPLEMENTER = { role: 'implementer', nextStatus: 'in_progress' } as never;
export const THEME1 = { themeId: 1, theme: { workingDirectory: null } };
export const THEME2 = { themeId: 2, theme: { workingDirectory: null } };
