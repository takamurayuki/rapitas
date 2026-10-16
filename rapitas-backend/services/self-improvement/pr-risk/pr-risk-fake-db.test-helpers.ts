/**
 * pr-risk-fake-db test helpers
 *
 * In-memory `PrRiskDb` for unit tests: supports the where shapes the store
 * uses (equality incl. null, `in`, `gte`/`lt`, `OR`) and composite unique keys.
 */
import type { PrRiskDb } from './pr-risk-db';

type Row = Record<string, unknown>;

function matchValue(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as { in?: unknown[]; gte?: Date; lt?: Date };
    if (c.in) return c.in.includes(value);
    const t = value instanceof Date ? value.getTime() : NaN;
    if (c.gte && !(t >= c.gte.getTime())) return false;
    if (c.lt && !(t < c.lt.getTime())) return false;
    return true;
  }
  if (cond instanceof Date) return value instanceof Date && value.getTime() === cond.getTime();
  return (value ?? null) === cond;
}

export function matchWhere(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    if (k === 'OR') return (cond as Row[]).some((w) => matchWhere(row, w));
    return matchValue(row[k], cond);
  });
}

/** Flatten a Prisma composite-unique where into plain equality. */
function flatWhere(where: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(where)) {
    if (k.includes('_') && v && typeof v === 'object') Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

function table(defaults: Row = {}) {
  const rows: Row[] = [];
  let nextId = 1;
  const find = (where: Row) => rows.find((r) => matchWhere(r, flatWhere(where))) ?? null;
  return {
    rows,
    findUnique: async ({ where }: { where: Row }) => find(where),
    findMany: async ({ where, orderBy, take }: { where?: Row; orderBy?: Row; take?: number }) => {
      let out = rows.filter((r) => matchWhere(r, where));
      if (orderBy) {
        const [[key, dir]] = Object.entries(orderBy);
        out = [...out].sort((a, b) => {
          const av = a[key] instanceof Date ? (a[key] as Date).getTime() : (a[key] as number);
          const bv = b[key] instanceof Date ? (b[key] as Date).getTime() : (b[key] as number);
          return dir === 'desc' ? (bv > av ? 1 : -1) : av > bv ? 1 : -1;
        });
      }
      return take ? out.slice(0, take) : out;
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: nextId++, createdAt: new Date(), ...defaults, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = find(where);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = find(where);
      if (row) return Object.assign(row, update);
      const created = { id: nextId++, createdAt: new Date(), ...defaults, ...create };
      rows.push(created);
      return created;
    },
  };
}

/**
 * Build a fresh in-memory PrRiskDb.
 *
 * @returns db plus raw tables for assertions / DB と生テーブル
 */
export function createFakeDb() {
  const tables = {
    prRiskConfig: table(),
    prRiskScore: table({ held: false, commentPostedAt: null, taskId: null }),
    prOutcome: table({
      mergeSha: null,
      mergedAt: null,
      label: 'pending',
      failureKind: null,
      revertSha: null,
      revertAt: null,
      incidentNote: null,
      labeledAt: null,
    }),
    prRiskMonthlyMetric: table(),
    prRiskThresholdReview: table(),
  };
  return { db: tables as unknown as PrRiskDb, tables };
}
