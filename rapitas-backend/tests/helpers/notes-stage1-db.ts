/**
 * notes-stage1-db
 *
 * An in-memory stand-in for the Prisma delegates the notes stage-1 services
 * use (Note, NoteTaskLink, NoteFolder, Task, Theme, Category,
 * TaskDeliverableCompletion, WorkflowFile, NoteMigrationMarker, and the
 * TaskCompanion / AssistantAction rows a roadmap commit leaves), with the
 * semantics those services rely on:
 *
 * - `where` matches on equality (NULL only matches NULL), plus the operators
 *   the services use (in, notIn, not, contains, startsWith, lt/lte/gt/gte,
 *   OR / AND / NOT, `taskLinks.some`, a 1-1 relation `null`).
 * - `create` throws P2002 on a taken key; `updateMany` / `deleteMany` return
 *   how many rows the condition hit.
 * - `@updatedAt` is stamped unless the write names `updatedAt` itself.
 * - The schema's onDelete rules (Cascade / SetNull) are applied on delete.
 * - `$transaction(fn)` rolls every table back when `fn` throws, so atomicity
 *   is testable as behaviour. The array form runs the operations in order.
 *
 * Not a general Prisma fake: only what these services call.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

class UniqueViolation extends Error {
  code = 'P2002';
}

const TABLES = [
  'note',
  'noteTaskLink',
  'noteFolder',
  'task',
  'theme',
  'category',
  'taskDeliverableCompletion',
  'workflowFile',
  'noteMigrationMarker',
  'taskCompanion',
  'assistantAction',
] as const;
export type TableName = (typeof TABLES)[number];

/** Primary key (or unique) fields per table, for P2002. */
const UNIQUE: Record<TableName, string[][]> = {
  note: [['id']],
  noteTaskLink: [['id'], ['noteId', 'taskId']],
  noteFolder: [['id']],
  task: [['id']],
  theme: [['id']],
  category: [['id']],
  taskDeliverableCompletion: [['taskId']],
  workflowFile: [['id'], ['taskId', 'fileType']],
  noteMigrationMarker: [['key']],
  taskCompanion: [['id'], ['taskId']],
  assistantAction: [['id']],
};

/** Defaults applied on create, mirroring the schema. */
const DEFAULTS: Partial<Record<TableName, Row>> = {
  note: {
    workspaceId: null,
    title: '',
    content: '',
    isPinned: false,
    tags: '[]',
    color: null,
    docType: null,
    version: null,
    themeId: null,
    categoryId: null,
    folderId: null,
    sourceTaskId: null,
    followsTask: false,
    source: 'manual',
    sourceRef: null,
  },
  noteTaskLink: { workspaceId: null, meta: null },
  noteFolder: { workspaceId: null, sortOrder: 0 },
  task: {
    workspaceId: null,
    themeId: null,
    parentId: null,
    status: 'todo',
    title: 'task',
    dueDate: null,
    completedAt: null,
  },
  theme: { workspaceId: null, categoryId: null, name: 'theme', sortOrder: 0 },
  category: { workspaceId: null, name: 'category', sortOrder: 0 },
  taskDeliverableCompletion: { workspaceId: null, attempts: 0, lastAttemptAt: null },
  workflowFile: { workspaceId: null, content: '' },
  noteMigrationMarker: { detail: null },
  taskCompanion: { workspaceId: null, origin: 'roadmap_commit', sourceActionId: null },
  assistantAction: { workspaceId: null, status: 'executed', resultJson: null },
};

const STAMPS_UPDATED_AT = new Set<TableName>(['note', 'task', 'noteFolder', 'theme', 'category']);
const AUTO_ID = new Set<TableName>([
  'noteTaskLink',
  'noteFolder',
  'task',
  'theme',
  'category',
  'workflowFile',
  'taskCompanion',
  'assistantAction',
]);

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : (a as number | string);
  const bv = b instanceof Date ? b.getTime() : (b as number | string);
  if (av === bv) return 0;
  if (av === null || av === undefined) return -1;
  if (bv === null || bv === undefined) return 1;
  return av < bv ? -1 : 1;
}

/** Create the database. Seeds are plain rows; defaults are filled in. */
export function createStage1Db(seed: Partial<Record<TableName, Row[]>> = {}) {
  let state: Record<TableName, Row[]> = Object.fromEntries(
    TABLES.map((t) => [t, [] as Row[]]),
  ) as Record<TableName, Row[]>;
  let clock = Date.parse('2026-11-01T00:00:00Z');
  const tick = () => new Date((clock += 1000));
  const nextId: Record<string, number> = {};
  const calls: string[] = [];
  const hooks: { beforeCreate?: (table: TableName, data: Row) => void | Promise<void> } = {};

  const fillDefaults = (table: TableName, data: Row): Row => {
    const now = tick();
    const row: Row = { ...(DEFAULTS[table] ?? {}), ...data };
    if (AUTO_ID.has(table) && row.id === undefined) {
      nextId[table] = (nextId[table] ?? 0) + 1;
      while (state[table].some((r) => r.id === nextId[table])) nextId[table] += 1;
      row.id = nextId[table];
    }
    if (STAMPS_UPDATED_AT.has(table)) {
      row.createdAt = row.createdAt ?? now;
      row.updatedAt = row.updatedAt ?? now;
    }
    if (table === 'noteMigrationMarker') row.appliedAt = row.appliedAt ?? now;
    return row;
  };

  const relationMatch = (
    table: TableName,
    row: Row,
    key: string,
    expected: unknown,
  ): boolean | undefined => {
    if (table === 'note' && key === 'taskLinks') {
      const some = (expected as { some?: Where }).some ?? {};
      return state.noteTaskLink.some(
        (l) => l.noteId === row.id && matches('noteTaskLink', l, some),
      );
    }
    if (table === 'task' && key === 'deliverableCompletion') {
      const has = state.taskDeliverableCompletion.some((c) => c.taskId === row.id);
      const wantNone = expected === null || (expected as { is?: unknown }).is === null;
      return wantNone ? !has : has;
    }
    if (table === 'taskDeliverableCompletion' && key === 'task') {
      const task = state.task.find((t) => t.id === row.taskId);
      return !!task && matches('task', task, expected as Where);
    }
    return undefined;
  };

  const opMatch = (value: unknown, op: Record<string, unknown>): boolean => {
    for (const [name, arg] of Object.entries(op)) {
      if (arg === undefined) continue;
      switch (name) {
        case 'in':
          if (!(arg as unknown[]).some((v) => same(value, v))) return false;
          break;
        case 'notIn':
          if (value === null || value === undefined) return false;
          if ((arg as unknown[]).some((v) => same(value, v))) return false;
          break;
        case 'not':
          if (arg !== null && typeof arg === 'object' && !(arg instanceof Date)) {
            if (opMatch(value, arg as Record<string, unknown>)) return false;
          } else if (same(value ?? null, arg)) return false;
          break;
        case 'equals':
          if (!same(value ?? null, arg)) return false;
          break;
        case 'contains':
          if (typeof value !== 'string' || !value.includes(arg as string)) return false;
          break;
        case 'startsWith':
          if (typeof value !== 'string' || !value.startsWith(arg as string)) return false;
          break;
        case 'lt':
          if (value === null || cmp(value, arg) >= 0) return false;
          break;
        case 'lte':
          if (value === null || cmp(value, arg) > 0) return false;
          break;
        case 'gt':
          if (value === null || cmp(value, arg) <= 0) return false;
          break;
        case 'gte':
          if (value === null || cmp(value, arg) < 0) return false;
          break;
        default:
          throw new Error(`notes-stage1-db: unsupported operator ${name}`);
      }
    }
    return true;
  };

  function matches(table: TableName, row: Row, where: Where | undefined): boolean {
    if (!where) return true;
    for (const [key, expected] of Object.entries(where)) {
      if (expected === undefined) continue;
      if (key === 'OR') {
        if (!(expected as Where[]).some((w) => matches(table, row, w))) return false;
        continue;
      }
      if (key === 'AND') {
        if (!(expected as Where[]).every((w) => matches(table, row, w))) return false;
        continue;
      }
      if (key === 'NOT') {
        const list = Array.isArray(expected) ? expected : [expected];
        if (list.some((w) => matches(table, row, w as Where))) return false;
        continue;
      }
      const rel = relationMatch(table, row, key, expected);
      if (rel !== undefined) {
        if (!rel) return false;
        continue;
      }
      if (key.includes('_') && expected && typeof expected === 'object') {
        if (!matches(table, row, expected as Where)) return false;
        continue;
      }
      if (expected !== null && typeof expected === 'object' && !(expected instanceof Date)) {
        if (!opMatch(row[key], expected as Record<string, unknown>)) return false;
        continue;
      }
      if (!same(row[key] ?? null, expected)) return false;
    }
    return true;
  }

  const project = (table: TableName, row: Row, args: Row): Row => {
    const full: Row = { ...row };
    const include = (args.include ?? {}) as Row;
    const select = args.select as Record<string, unknown> | undefined;
    const wantsLinks = include.taskLinks || select?.taskLinks;
    if (table === 'note' && wantsLinks) {
      full.taskLinks = state.noteTaskLink
        .filter((l) => l.noteId === row.id)
        .map((l) => ({ taskId: l.taskId, meta: l.meta }));
    }
    if (table === 'taskDeliverableCompletion' && (include.task || select?.task)) {
      const task = state.task.find((t) => t.id === row.taskId);
      full.task = task ? { ...task } : null;
    }
    if (!select) return full;
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => [k, full[k]]),
    );
  };

  const sortRows = (rows: Row[], orderBy: unknown): Row[] => {
    const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
      string,
      'asc' | 'desc'
    >[];
    return [...rows].sort((a, b) => {
      for (const o of orders) {
        const [key, dir] = Object.entries(o)[0] as [string, 'asc' | 'desc'];
        const c = cmp(
          a[key] === true ? 1 : a[key] === false ? 0 : a[key],
          b[key] === true ? 1 : b[key] === false ? 0 : b[key],
        );
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  };

  const checkUnique = (table: TableName, row: Row, except?: Row) => {
    for (const fields of UNIQUE[table]) {
      const clash = state[table].some(
        (r) => r !== except && fields.every((f) => r[f] !== undefined && same(r[f], row[f])),
      );
      if (clash) throw new UniqueViolation(`${table} ${fields.join(',')} taken`);
    }
  };

  const removeRows = (table: TableName, rows: Row[]) => {
    state[table] = state[table].filter((r) => !rows.includes(r));
    for (const row of rows) {
      const id = row.id;
      if (table === 'note') state.noteTaskLink = state.noteTaskLink.filter((l) => l.noteId !== id);
      if (table === 'task') {
        state.noteTaskLink = state.noteTaskLink.filter((l) => l.taskId !== id);
        state.taskDeliverableCompletion = state.taskDeliverableCompletion.filter(
          (c) => c.taskId !== id,
        );
        state.workflowFile = state.workflowFile.filter((f) => f.taskId !== id);
        for (const n of state.note) if (n.sourceTaskId === id) n.sourceTaskId = null;
        removeRows(
          'task',
          state.task.filter((t) => t.parentId === id),
        );
      }
      if (table === 'theme') {
        for (const n of state.note) if (n.themeId === id) n.themeId = null;
        for (const t of state.task) if (t.themeId === id) t.themeId = null;
      }
      if (table === 'category') {
        for (const n of state.note) if (n.categoryId === id) n.categoryId = null;
        for (const t of state.theme) if (t.categoryId === id) t.categoryId = null;
      }
      if (table === 'noteFolder')
        for (const n of state.note) if (n.folderId === id) n.folderId = null;
    }
  };

  const delegate = (table: TableName) => ({
    async findFirst(args: Row = {}) {
      calls.push(`${table}.findFirst`);
      const hit = sortRows(
        state[table].filter((r) => matches(table, r, args.where as Where)),
        args.orderBy,
      )[0];
      return hit ? project(table, hit, args) : null;
    },
    async findUnique(args: Row = {}) {
      calls.push(`${table}.findUnique`);
      const hit = state[table].find((r) => matches(table, r, args.where as Where));
      return hit ? project(table, hit, args) : null;
    },
    async findMany(args: Row = {}) {
      calls.push(`${table}.findMany`);
      let list = sortRows(
        state[table].filter((r) => matches(table, r, args.where as Where)),
        args.orderBy,
      );
      if (typeof args.skip === 'number') list = list.slice(args.skip);
      if (typeof args.take === 'number') list = list.slice(0, args.take);
      return list.map((r) => project(table, r, args));
    },
    async count(args: Row = {}) {
      return state[table].filter((r) => matches(table, r, args.where as Where)).length;
    },
    async create(args: Row) {
      calls.push(`${table}.create`);
      await hooks.beforeCreate?.(table, args.data as Row);
      const row = fillDefaults(table, args.data as Row);
      checkUnique(table, row);
      state[table].push(row);
      return project(table, row, args);
    },
    async updateMany(args: Row) {
      calls.push(`${table}.updateMany`);
      const data = args.data as Row;
      let count = 0;
      for (const r of state[table]) {
        if (!matches(table, r, args.where as Where)) continue;
        const next = { ...r, ...data };
        if (STAMPS_UPDATED_AT.has(table) && data.updatedAt === undefined) next.updatedAt = tick();
        checkUnique(table, next, r);
        Object.assign(r, next);
        count += 1;
      }
      return { count };
    },
    async update(args: Row) {
      calls.push(`${table}.update`);
      const hit = state[table].find((r) => matches(table, r, args.where as Where));
      if (!hit) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      const data = args.data as Row;
      Object.assign(hit, data);
      if (STAMPS_UPDATED_AT.has(table) && data.updatedAt === undefined) hit.updatedAt = tick();
      return project(table, hit, args);
    },
    async deleteMany(args: Row = {}) {
      calls.push(`${table}.deleteMany`);
      const hits = state[table].filter((r) => matches(table, r, args.where as Where));
      removeRows(table, hits);
      return { count: hits.length };
    },
  });

  const clone = () =>
    Object.fromEntries(TABLES.map((t) => [t, state[t].map((r) => ({ ...r }))])) as Record<
      TableName,
      Row[]
    >;

  const prisma: Record<string, unknown> = Object.fromEntries(TABLES.map((t) => [t, delegate(t)]));
  prisma.$transaction = async (arg: unknown) => {
    calls.push('$transaction');
    if (Array.isArray(arg)) return Promise.all(arg);
    const snapshot = clone();
    try {
      return await (arg as (tx: unknown) => Promise<unknown>)(prisma);
    } catch (error) {
      state = snapshot;
      throw error;
    }
  };

  for (const t of TABLES) for (const row of seed[t] ?? []) state[t].push(fillDefaults(t, row));

  return {
    prisma,
    rows: (t: TableName) => state[t],
    find: (t: TableName, where: Where) => state[t].find((r) => matches(t, r, where)),
    calls,
    hooks,
    tick,
    now: () => new Date(clock),
  };
}

export type Stage1Db = ReturnType<typeof createStage1Db>;
