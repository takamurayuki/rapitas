/**
 * assistant-companion digest route tests (companion design stage 2 item 1)
 *
 * Acceptance: once an accompanied task comes to wait on a person, the next
 * digest read shows what happened, what the person decides and the screen to
 * decide on. The cursor moves only when the client reports what it showed,
 * and only forward. Rows live in a small in-memory store so the assertions
 * are about persisted state, not mock arguments.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

type Row = Record<string, unknown>;
let companions: Row[];
let tasks: Row[];
let transitions: Row[];

/** Matches the where shapes the digest uses: equality, null, in, gt, lt, gte, OR. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((c) => matches(row, c));
    const value = row[key];
    if (cond === null) return value === null || value === undefined;
    if (cond instanceof Date) return new Date(value as string).getTime() === cond.getTime();
    if (typeof cond === 'object') {
      const c = cond as Record<string, unknown>;
      const cmp = (v: unknown) => (v instanceof Date ? v.getTime() : (v as number));
      const val =
        value instanceof Date || typeof value === 'string' ? cmp(new Date(value as string)) : value;
      if ('in' in c && !(c.in as unknown[]).includes(value)) return false;
      if ('gt' in c && !(value != null && (val as number) > cmp(c.gt))) return false;
      if ('lt' in c && !(value != null && (val as number) < cmp(c.lt))) return false;
      if ('gte' in c && !(value != null && (val as number) >= cmp(c.gte))) return false;
      return true;
    }
    return value === cond;
  });
}

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: {
    taskCompanion: {
      findMany: async ({ where }: { where: Row }) => companions.filter((r) => matches(r, where)),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hit = companions.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
    task: {
      findMany: async ({ where }: { where: Row }) => tasks.filter((r) => matches(r, where)),
    },
    workflowTransition: {
      findMany: async ({ where, take }: { where: Row; take: number }) =>
        transitions
          .filter((r) => matches(r, where))
          .sort((a, b) => (b.id as number) - (a.id as number))
          .slice(0, take),
    },
    assistantAction: { create: async () => ({ id: 1 }) },
  },
}));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));
mock.module('../../services/workflow/repair-escalation', () => ({
  summarizeRepairCauses: async (taskId: number) => ({
    capability: taskId === 42 ? 2 : 0,
    infrastructure: 0,
    requirements: 0,
    unfounded: 0,
  }),
}));
mock.module('../../services/workflow/review-hold', () => ({
  REVIEW_HOLD_HALT_REASON: 'awaiting_review_decision',
  readReviewHold: async () => ({ reason: 'unresolved_dispute', detail: '', findings: [] }),
  probeReviewHold: async () => ({ state: 'clear' }),
}));

const { default: routes } = await import('./assistant-companion.routes');

async function getDigest() {
  const res = await routes.handle(new Request('http://localhost/assistant/companion/digest'));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function seen(cursors: unknown) {
  const res = await routes.handle(
    new Request('http://localhost/assistant/companion/digest/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursors }),
    }),
  );
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

let seq = 100;
function addTransition(taskId: number, over: Row): Row {
  const row = {
    id: seq++,
    taskId,
    fromStatus: null,
    toStatus: 'draft',
    cause: 'auto_advance',
    createdAt: new Date('2026-11-12T03:00:00Z'),
    invariantViolation: false,
    ...over,
  };
  transitions.push(row);
  return row;
}

type Item = {
  taskId: number;
  decision: { kind: string; link: string; holdReason?: string } | null;
  recent: { kind: string }[];
  since: { transitions: number };
  repairs: { total: number; topCause: string | null };
  cursor: number | null;
};

beforeEach(() => {
  companions = [
    {
      taskId: 42,
      lastDigestTransitionId: null,
      startedAt: new Date('2026-11-12T00:00:00Z'),
      closedAt: null,
    },
    {
      taskId: 43,
      lastDigestTransitionId: null,
      startedAt: new Date('2026-11-12T00:00:00Z'),
      closedAt: new Date(),
    },
  ];
  tasks = [
    {
      id: 42,
      title: '設定画面を作る',
      status: 'in-progress',
      workflowStatus: 'plan_created',
      haltReason: null,
    },
    {
      id: 43,
      title: '閉じた伴走',
      status: 'in-progress',
      workflowStatus: 'plan_created',
      haltReason: null,
    },
  ];
  transitions = [];
});

describe('GET /assistant/companion/digest → POST /digest/seen', () => {
  test('a task that came to wait on you: what happened, what you decide, the screen', async () => {
    addTransition(42, { toStatus: 'research_done', cause: 'file_saved:research' });
    const plan = addTransition(42, {
      fromStatus: 'research_done',
      toStatus: 'plan_created',
      cause: 'file_saved:plan',
    });

    const first = await getDigest();
    expect(first.status).toBe(200);
    const items = first.body.items as Item[];
    // The closed companion (43) is not reported even though it waits.
    expect(items.map((i) => i.taskId)).toEqual([42]);
    expect(items[0].recent[0].kind).toBe('plan_ready');
    expect(items[0].decision).toEqual({ kind: 'approve_plan', link: '/tasks/42/decide' });
    expect(items[0].repairs).toEqual({ total: 2, topCause: 'capability' });
    expect(items[0].cursor).toBe(plan.id as number);
    expect(first.body.decisionCount).toBe(1);

    // Reading alone does not move the cursor.
    expect(companions[0].lastDigestTransitionId).toBeNull();

    const ack = await seen([{ taskId: 42, transitionId: plan.id }]);
    expect(ack.body).toEqual({ success: true, moved: 1 });
    expect(companions[0].lastDigestTransitionId).toBe(plan.id);

    // Seen, but still undecided: the decision stays, the news does not.
    const second = (await getDigest()).body.items as Item[];
    expect(second[0].since.transitions).toBe(0);
    expect(second[0].decision?.kind).toBe('approve_plan');

    // The person approves (on the decision screen, not through ラピ).
    tasks[0].workflowStatus = 'plan_approved';
    addTransition(42, {
      fromStatus: 'plan_created',
      toStatus: 'plan_approved',
      cause: 'manual_plan_approved',
    });
    const third = (await getDigest()).body.items as Item[];
    expect(third[0].decision).toBeNull();
    expect(third[0].recent[0].kind).toBe('decided');
  });

  test('a review hold carries its reason', async () => {
    tasks[0].workflowStatus = 'verify_done';
    tasks[0].haltReason = 'awaiting_review_decision';
    const items = (await getDigest()).body.items as Item[];
    expect(items[0].decision).toEqual({
      kind: 'review_hold',
      holdReason: 'unresolved_dispute',
      link: '/tasks/42/decide',
    });
  });

  test('the cursor never moves backwards and closed rows are left alone', async () => {
    companions[0].lastDigestTransitionId = 500;
    expect((await seen([{ taskId: 42, transitionId: 400 }])).body.moved).toBe(0);
    expect(companions[0].lastDigestTransitionId).toBe(500);
    expect((await seen([{ taskId: 43, transitionId: 900 }])).body.moved).toBe(0);
    expect(companions[1].lastDigestTransitionId).toBeNull();
  });

  test('rejects a malformed seen report', async () => {
    const res = await seen([{ taskId: 'x', transitionId: 1 }]);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(companions[0].lastDigestTransitionId).toBeNull();
  });
});
