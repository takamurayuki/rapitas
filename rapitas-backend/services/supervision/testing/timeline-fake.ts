/**
 * TimelineFake
 *
 * In-memory stand-in for services/memory/timeline used by supervision tests. It
 * mirrors the real append/query semantics (JSON round-trip, filters, newest-first
 * ordering, limit, total) so tests exercise the detectors' actual logic instead of
 * canned return values. Test-only; never imported by production code.
 */

export interface FakeTimelineRow {
  id: number;
  eventType: string;
  actorType: string;
  actorId: string | null;
  payload: string;
  correlationId: string | null;
  createdAt: Date;
}

export interface TimelineFake {
  rows: FakeTimelineRow[];
  /** Clock used for createdAt of appended rows. */
  now: () => Date;
  setNow: (d: Date) => void;
  /** When > 0, the next N appends (optionally of one eventType) throw. */
  failNextAppends: (count: number, eventType?: string) => void;
  seed: (row: {
    eventType: string;
    payload: Record<string, unknown>;
    correlationId?: string;
    createdAt: Date;
  }) => void;
  module: {
    appendEvent: (event: {
      eventType: string;
      actorType?: string;
      actorId?: string;
      payload?: Record<string, unknown>;
      correlationId?: string;
    }) => Promise<{ id: number }>;
    queryEvents: (options?: {
      eventType?: string;
      actorType?: string;
      correlationId?: string;
      since?: Date;
      until?: Date;
      limit?: number;
      offset?: number;
    }) => Promise<{
      events: Array<Omit<FakeTimelineRow, 'payload'> & { payload: unknown }>;
      total: number;
      limit: number;
      offset: number;
    }>;
  };
}

/**
 * Creates a fresh fake timeline store.
 *
 * @param start - Initial clock value / 初期時刻
 * @returns Fake store with a timeline-compatible module / 偽タイムライン
 */
export function createTimelineFake(start: Date = new Date('2026-09-10T00:00:00Z')): TimelineFake {
  const rows: FakeTimelineRow[] = [];
  let clock = start;
  let failCount = 0;
  let failType: string | undefined;
  let nextId = 1;

  const fake: TimelineFake = {
    rows,
    now: () => clock,
    setNow: (d) => {
      clock = d;
    },
    failNextAppends: (count, eventType) => {
      failCount = count;
      failType = eventType;
    },
    seed: (row) => {
      rows.push({
        id: nextId++,
        eventType: row.eventType,
        actorType: 'system',
        actorId: null,
        payload: JSON.stringify(row.payload),
        correlationId: row.correlationId ?? null,
        createdAt: row.createdAt,
      });
    },
    module: {
      appendEvent: async (event) => {
        if (failCount > 0 && (!failType || failType === event.eventType)) {
          failCount -= 1;
          throw new Error('simulated timeline write failure');
        }
        const id = nextId++;
        rows.push({
          id,
          eventType: event.eventType,
          actorType: event.actorType ?? 'system',
          actorId: event.actorId ?? null,
          payload: JSON.stringify(event.payload ?? {}),
          correlationId: event.correlationId ?? null,
          createdAt: clock,
        });
        return { id };
      },
      queryEvents: async (options = {}) => {
        const { limit = 50, offset = 0 } = options;
        const matched = rows
          .filter((r) => !options.eventType || r.eventType === options.eventType)
          .filter((r) => !options.actorType || r.actorType === options.actorType)
          .filter((r) => !options.correlationId || r.correlationId === options.correlationId)
          .filter((r) => !options.since || r.createdAt >= options.since)
          .filter((r) => !options.until || r.createdAt <= options.until)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
        return {
          events: matched
            .slice(offset, offset + limit)
            .map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
          total: matched.length,
          limit,
          offset,
        };
      },
    },
  };
  return fake;
}

type Where = Record<string, unknown>;
type StringFilter = { in?: unknown[]; startsWith?: string; endsWith?: string; gte?: Date };

export interface FakeTransitionRow {
  taskId: number;
  toStatus: string;
  cause: string;
  actor?: string;
  createdAt: Date;
}
export interface FakeTaskRow {
  id: number;
  status?: string;
  parentId: number | null;
  acceptanceCriteria: string | null;
  updatedAt?: Date;
}
export interface FakePrRow {
  linkedTaskId: number | null;
  state: string;
}

export interface PrismaFakeState {
  transitions: FakeTransitionRow[];
  tasks: FakeTaskRow[];
  pullRequests: FakePrRow[];
  /** UserSettings.autoMergePRDefault served to resolveAutomationPolicy. */
  autoMergePRDefault: boolean | null;
  failPullRequests: boolean;
  failUserSettings: boolean;
}

/** Evaluates the subset of Prisma `where` operators the supervision queries use. */
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((c) => matches(row, c));
    if (key === 'AND') return (cond as Where[]).every((c) => matches(row, c));
    const value = row[key];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const f = cond as StringFilter;
      if (f.in && !f.in.includes(value)) return false;
      if (f.startsWith !== undefined && !String(value).startsWith(f.startsWith)) return false;
      if (f.endsWith !== undefined && !String(value).endsWith(f.endsWith)) return false;
      if (f.gte && !(value instanceof Date && value >= f.gte)) return false;
      return true;
    }
    return value === cond;
  });
}

/**
 * Creates an in-memory Prisma stand-in for the supervision evidence queries
 * (transitions, tasks, PR mirror, user settings) with where-filter semantics.
 *
 * @returns Mutable state plus the `prisma` object to mock `config/database` with / 状態とprisma
 */
export function createPrismaFake(): { state: PrismaFakeState; prisma: Record<string, unknown> } {
  const state: PrismaFakeState = {
    transitions: [],
    tasks: [],
    pullRequests: [],
    autoMergePRDefault: true,
    failPullRequests: false,
    failUserSettings: false,
  };
  const rows = <T extends object>(list: T[], args?: { where?: Where; take?: number }) =>
    list
      .filter((r) => matches(r as Record<string, unknown>, args?.where))
      .slice(0, args?.take ?? Infinity);
  const prisma = {
    workflowTransition: {
      findMany: async (args?: { where?: Where; take?: number }) =>
        rows(state.transitions, args).map((t, i) => ({ id: i + 1, actor: 'system', ...t })),
    },
    task: {
      findMany: async (args?: { where?: Where; take?: number }) =>
        rows(
          state.tasks.map((t) => ({ status: 'done', updatedAt: new Date(0), ...t })),
          args,
        ),
      findUnique: async (args: { where: { id: number } }) =>
        state.tasks.find((t) => t.id === args.where.id) ? { id: args.where.id } : null,
    },
    gitHubPullRequest: {
      findMany: async (args?: { where?: Where; take?: number }) => {
        if (state.failPullRequests) throw new Error('pr mirror down');
        return rows(state.pullRequests, args);
      },
    },
    userSettings: {
      findFirst: async () => {
        if (state.failUserSettings) throw new Error('settings down');
        return { autoMergePRDefault: state.autoMergePRDefault };
      },
    },
  };
  return { state, prisma };
}
