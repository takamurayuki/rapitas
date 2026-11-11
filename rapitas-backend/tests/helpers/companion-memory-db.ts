/**
 * companion-memory-db
 *
 * A small in-memory stand-in for the Task / TaskCompanion slice of Prisma, for
 * tests that need rows to actually persist, roll back and be filtered — not
 * just a record of what a mock was called with (G2 review on the companion
 * stage 1: the "two created, then failed" test checked mock arguments, not
 * rows).
 *
 * - `$transaction(fn)` runs `fn` against the same client and restores every
 *   table if it throws, which is the property the companion writes rely on.
 * - `scopedByWorkspace(db, owned)` routes every call through the REAL
 *   workspace extension (`createWorkspaceExtension`), so `runInWorkspace`
 *   filters and stamps exactly as it does in the server.
 *
 * Supports only the operations and `where` shapes the companion paths use:
 * equality, `null`, and `{ in: [...] }`.
 *
 * Generated clients are not involved: the local one predates TaskCompanion and
 * regenerating it is not done by hand here.
 */
import {
  createWorkspaceExtension,
  type BaseClientLike,
} from '../../services/tenancy/workspace-extension';

export type MemoryRow = Record<string, unknown> & { id: number };

/** The models this store knows, by Prisma model name. */
export type MemoryModel = 'Task' | 'TaskCompanion' | 'TaskLabel';

const DELEGATES: Record<MemoryModel, string> = {
  Task: 'task',
  TaskCompanion: 'taskCompanion',
  TaskLabel: 'taskLabel',
};

/** Defaults a real insert would fill in. */
const DEFAULTS: Record<MemoryModel, () => Record<string, unknown>> = {
  Task: () => ({ workspaceId: null, parentId: null, status: 'todo', createdAt: new Date() }),
  TaskCompanion: () => ({
    workspaceId: null,
    sourceActionId: null,
    startedAt: new Date(),
    lastDigestTransitionId: null,
    closedAt: null,
    closedReason: null,
    retrospectiveNoteId: null,
  }),
  TaskLabel: () => ({}),
};

/** Fields that must be unique per model (the schema's @unique). */
const UNIQUE: Record<MemoryModel, string[]> = {
  Task: [],
  TaskCompanion: ['taskId'],
  TaskLabel: [],
};

function matches(row: MemoryRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    const value = row[key] ?? null;
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'in' in cond) {
      if (!(cond as { in: unknown[] }).in.includes(value)) return false;
      continue;
    }
    if ((cond ?? null) !== value) return false;
  }
  return true;
}

function pick(row: MemoryRow, select: Record<string, unknown> | undefined): MemoryRow {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(select)) if (select[key]) out[key] = row[key] ?? null;
  return out as MemoryRow;
}

type Args = {
  where?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  select?: Record<string, unknown>;
};

/** An in-memory client, plus direct access to its tables for assertions. */
export interface MemoryDb {
  tables: Record<MemoryModel, MemoryRow[]>;
  client: Record<string, unknown> & {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
  };
  /** Make the next call of `model.operation` throw this error. */
  failNext(model: MemoryModel, operation: string, error: unknown): void;
}

/**
 * Build an empty store.
 *
 * @returns The client and its tables / クライアントとテーブル
 */
export function createMemoryDb(): MemoryDb {
  const tables: Record<MemoryModel, MemoryRow[]> = { Task: [], TaskCompanion: [], TaskLabel: [] };
  const nextId: Record<MemoryModel, number> = { Task: 100, TaskCompanion: 1, TaskLabel: 1 };
  const failures = new Map<string, unknown>();

  const maybeFail = (model: MemoryModel, op: string) => {
    const key = `${model}.${op}`;
    if (failures.has(key)) {
      const err = failures.get(key);
      failures.delete(key);
      throw err;
    }
  };

  const insert = (model: MemoryModel, data: Record<string, unknown>): MemoryRow => {
    for (const field of UNIQUE[model]) {
      if (tables[model].some((r) => r[field] === data[field])) {
        throw Object.assign(new Error(`Unique constraint failed on ${model}.${field}`), {
          code: 'P2002',
        });
      }
    }
    const row = { ...DEFAULTS[model](), ...data, id: nextId[model]++ } as MemoryRow;
    tables[model].push(row);
    return row;
  };

  const delegate = (model: MemoryModel) => ({
    async findUnique(args: Args) {
      maybeFail(model, 'findUnique');
      const row = tables[model].find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    async findFirst(args: Args) {
      maybeFail(model, 'findFirst');
      const row = tables[model].find((r) => matches(r, args.where));
      return row ? pick(row, args.select) : null;
    },
    async findMany(args: Args = {}) {
      maybeFail(model, 'findMany');
      return tables[model].filter((r) => matches(r, args.where)).map((r) => pick(r, args.select));
    },
    async create(args: Args) {
      maybeFail(model, 'create');
      return { ...insert(model, args.data as Record<string, unknown>) };
    },
    async createMany(args: Args) {
      maybeFail(model, 'createMany');
      const rows = (args.data as Record<string, unknown>[]) ?? [];
      for (const r of rows) insert(model, r);
      return { count: rows.length };
    },
    async update(args: Args) {
      maybeFail(model, 'update');
      const row = tables[model].find((r) => matches(r, args.where));
      if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
      Object.assign(row, args.data);
      return { ...row };
    },
    async updateMany(args: Args) {
      maybeFail(model, 'updateMany');
      const rows = tables[model].filter((r) => matches(r, args.where));
      for (const r of rows) Object.assign(r, args.data);
      return { count: rows.length };
    },
    async delete(args: Args) {
      maybeFail(model, 'delete');
      const i = tables[model].findIndex((r) => matches(r, args.where));
      if (i < 0)
        throw Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025' });
      const [row] = tables[model].splice(i, 1);
      if (model === 'Task') cascadeSubtasks(row.id);
      return row;
    },
  });

  // Task.parentId is onDelete: Cascade; TaskCompanion deliberately has no FK.
  const cascadeSubtasks = (parentId: number) => {
    const children = tables.Task.filter((t) => t.parentId === parentId);
    tables.Task = tables.Task.filter((t) => t.parentId !== parentId);
    for (const c of children) cascadeSubtasks(c.id);
  };

  const client = {
    task: delegate('Task'),
    taskCompanion: delegate('TaskCompanion'),
    taskLabel: delegate('TaskLabel'),
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const saved = {
        Task: tables.Task.map((r) => ({ ...r })),
        TaskCompanion: tables.TaskCompanion.map((r) => ({ ...r })),
        TaskLabel: tables.TaskLabel.map((r) => ({ ...r })),
      };
      try {
        return await fn(client);
      } catch (err) {
        tables.Task = saved.Task;
        tables.TaskCompanion = saved.TaskCompanion;
        tables.TaskLabel = saved.TaskLabel;
        throw err;
      }
    },
  };

  return {
    get tables() {
      return tables;
    },
    client,
    failNext(model, operation, error) {
      failures.set(`${model}.${operation}`, error);
    },
  } as MemoryDb;
}

/**
 * Wrap a store so every call goes through the real workspace extension.
 *
 * @param db - The store / ストア
 * @param owned - Models carrying workspaceId (default: Task and TaskCompanion) / 所有モデル
 * @returns A client scoped by `runInWorkspace` the way the server's is / スコープされたクライアント
 */
export function scopedByWorkspace(
  db: MemoryDb,
  owned: ReadonlySet<string> = new Set(['Task', 'TaskCompanion']),
): MemoryDb['client'] {
  const base = db.client as unknown as BaseClientLike;
  const ext = createWorkspaceExtension(owned, base);
  const wrapped: Record<string, unknown> = {};
  for (const [model, name] of Object.entries(DELEGATES)) {
    const inner = base[name];
    wrapped[name] = new Proxy(inner, {
      get(target, op: string) {
        const run = target[op];
        if (typeof run !== 'function') return run;
        return (args: unknown) =>
          ext.query.$allModels.$allOperations({
            model,
            operation: op,
            args,
            query: (a: unknown) => run.call(target, a),
          });
      },
    });
  }
  const scoped = wrapped as MemoryDb['client'];
  scoped.$transaction = <T>(fn: (tx: unknown) => Promise<T>) =>
    db.client.$transaction(() => fn(scoped));
  return scoped;
}
