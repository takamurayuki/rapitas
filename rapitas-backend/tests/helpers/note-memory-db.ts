/**
 * note-memory-db
 *
 * An in-memory stand-in for the Note / NoteTaskLink / Task delegates, with
 * the semantics the note services rely on: `where` matches on equality
 * (NULL only matches NULL), `updateMany` returns how many rows the condition
 * hit, `create` throws P2002 on a taken key, and `@updatedAt` is stamped
 * unless the write names `updatedAt` itself.
 *
 * Exists so the version contract can be tested as behaviour — a stale
 * `ifVersion` really matches nothing — rather than as the shape of a call.
 * `beforeUpdateMany` lets a test slip a competing write between a service's
 * read and its conditional update. Not a general Prisma fake.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

export interface MemoryNote extends Row {
  id: string;
  workspaceId: number | null;
  title: string;
  content: string;
  isPinned: boolean;
  tags: string;
  color: string | null;
  docType: string | null;
  version: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryLink extends Row {
  id: number;
  workspaceId: number | null;
  noteId: string;
  taskId: number;
  meta: string | null;
}

export interface MemoryTask extends Row {
  id: number;
  workspaceId: number | null;
}

class UniqueViolation extends Error {
  code = 'P2002';
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/** Apply a Prisma-style `where` to one row. */
function matches(row: Row, where: Where | undefined, links: MemoryLink[]): boolean {
  if (!where) return true;
  for (const [key, expected] of Object.entries(where)) {
    // Prisma ignores a condition whose value is undefined.
    if (expected === undefined) continue;
    if (key === 'taskLinks') {
      const some = (expected as { some?: { taskId?: number } }).some;
      const ok = links.some((l) => l.noteId === row.id && l.taskId === some?.taskId);
      if (!ok) return false;
      continue;
    }
    if (key === 'noteId_taskId') {
      const k = expected as { noteId: string; taskId: number };
      if (row.noteId !== k.noteId || row.taskId !== k.taskId) return false;
      continue;
    }
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const op = expected as { in?: unknown[] };
      if (op.in && !op.in.some((v) => same(row[key], v))) return false;
      continue;
    }
    if (!same(row[key] ?? null, expected)) return false;
  }
  return true;
}

/** Build the in-memory database and its client-shaped facade. */
export function createNoteMemoryDb(seed: { tasks?: MemoryTask[] } = {}) {
  const notes = new Map<string, MemoryNote>();
  const links: MemoryLink[] = [];
  const tasks: MemoryTask[] = [...(seed.tasks ?? [])];
  let clock = Date.parse('2026-11-01T00:00:00Z');
  let nextLinkId = 1;
  const tick = () => new Date((clock += 1000));
  const hooks: { beforeUpdateMany?: (where: Where) => void | Promise<void> } = {};
  const counts = { noteUpdateMany: 0, noteCreate: 0 };

  const withLinks = (n: MemoryNote, include?: Row) =>
    include?.taskLinks
      ? {
          ...n,
          taskLinks: links
            .filter((l) => l.noteId === n.id)
            .map((l) => ({ taskId: l.taskId, meta: l.meta })),
        }
      : { ...n };

  const project = (n: MemoryNote, args: Row) => {
    const full = withLinks(n, args.include as Row | undefined);
    const select = args.select as Record<string, boolean> | undefined;
    if (!select) return full;
    return Object.fromEntries(Object.keys(select).map((k) => [k, (full as Row)[k]]));
  };

  const note = {
    async findFirst(args: Row) {
      const hit = [...notes.values()].find((n) => matches(n, args.where as Where, links));
      return hit ? project(hit, args) : null;
    },
    async findUnique(args: Row) {
      const id = (args.where as { id: string }).id;
      const hit = notes.get(id);
      return hit ? project(hit, args) : null;
    },
    async findMany(args: Row = {}) {
      let list = [...notes.values()].filter((n) => matches(n, args.where as Where, links));
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
      if (typeof args.take === 'number') list = list.slice(0, args.take);
      return list.map((n) => project(n, args));
    },
    async create(args: Row) {
      counts.noteCreate += 1;
      const data = args.data as Row;
      const id = data.id as string;
      if (notes.has(id)) throw new UniqueViolation(`Note ${id} exists`);
      const now = tick();
      const row: MemoryNote = {
        workspaceId: null,
        content: '',
        isPinned: false,
        tags: '[]',
        color: null,
        docType: null,
        version: null,
        createdAt: now,
        updatedAt: now,
        ...(data as Partial<MemoryNote>),
        id,
        title: (data.title as string) ?? '',
      };
      notes.set(id, row);
      return project(row, args);
    },
    async updateMany(args: Row) {
      await hooks.beforeUpdateMany?.(args.where as Where);
      counts.noteUpdateMany += 1;
      const data = args.data as Partial<MemoryNote>;
      let count = 0;
      for (const n of notes.values()) {
        if (!matches(n, args.where as Where, links)) continue;
        Object.assign(n, data, { updatedAt: data.updatedAt ?? tick() });
        count += 1;
      }
      return { count };
    },
    async deleteMany(args: Row) {
      let count = 0;
      for (const n of [...notes.values()]) {
        if (!matches(n, args.where as Where, links)) continue;
        notes.delete(n.id);
        for (let i = links.length - 1; i >= 0; i -= 1) {
          if (links[i]?.noteId === n.id) links.splice(i, 1);
        }
        count += 1;
      }
      return { count };
    },
  };

  const noteTaskLink = {
    async findFirst(args: Row) {
      return links.find((l) => matches(l, args.where as Where, links)) ?? null;
    },
    async findMany(args: Row = {}) {
      return links.filter((l) => matches(l, args.where as Where, links));
    },
    async create(args: Row) {
      const data = args.data as Partial<MemoryLink>;
      if (links.some((l) => l.noteId === data.noteId && l.taskId === data.taskId)) {
        throw new UniqueViolation('link exists');
      }
      const row: MemoryLink = {
        id: nextLinkId++,
        workspaceId: data.workspaceId ?? null,
        noteId: data.noteId as string,
        taskId: data.taskId as number,
        meta: data.meta ?? null,
      };
      links.push(row);
      return { ...row };
    },
    async updateMany(args: Row) {
      let count = 0;
      for (const l of links) {
        if (!matches(l, args.where as Where, links)) continue;
        Object.assign(l, args.data as Row);
        count += 1;
      }
      return { count };
    },
    async upsert(args: Row) {
      const existing = links.find((l) => matches(l, args.where as Where, links));
      if (existing) {
        Object.assign(existing, args.update as Row);
        return { ...existing };
      }
      return noteTaskLink.create({ data: args.create });
    },
    async deleteMany(args: Row) {
      const before = links.length;
      for (let i = links.length - 1; i >= 0; i -= 1) {
        const l = links[i];
        if (l && matches(l, args.where as Where, links)) links.splice(i, 1);
      }
      return { count: before - links.length };
    },
  };

  const task = {
    async findFirst(args: Row) {
      const hit = tasks.find((t) => matches(t, args.where as Where, links));
      return hit ? { ...hit } : null;
    },
  };

  return { prisma: { note, noteTaskLink, task }, notes, links, tasks, hooks, counts, tick };
}

export type NoteMemoryDb = ReturnType<typeof createNoteMemoryDb>;
