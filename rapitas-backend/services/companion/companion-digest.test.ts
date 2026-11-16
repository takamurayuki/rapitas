/**
 * companion-digest tests (companion design 段D, stage 2 item 1)
 *
 * The digest is counted, not written by a model: what happened since the
 * cursor, and what waits on a person read from the task's current columns.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildCompanionDigest,
  classifyTransition,
  decisionFor,
  MAX_DIGEST_EVENTS,
  type DigestInput,
  type DigestTaskRow,
  type DigestTransitionRow,
} from './companion-digest';

const NOW = new Date('2026-11-12T12:00:00Z');
const STARTED = '2026-11-12T00:00:00Z';

function task(id: number, over: Partial<DigestTaskRow> = {}): DigestTaskRow {
  return {
    id,
    title: `タスク${id}`,
    status: 'in-progress',
    workflowStatus: 'in_progress',
    haltReason: null,
    ...over,
  };
}

let nextId = 1;
function tr(taskId: number, over: Partial<DigestTransitionRow> = {}): DigestTransitionRow {
  return {
    id: nextId++,
    taskId,
    fromStatus: 'in_progress',
    toStatus: 'in_progress',
    cause: 'auto_advance',
    createdAt: '2026-11-12T06:00:00Z',
    invariantViolation: false,
    ...over,
  };
}

function input(over: Partial<DigestInput>): DigestInput {
  return {
    companions: [],
    tasks: [],
    transitions: [],
    repairs: new Map(),
    holdReasons: new Map(),
    now: NOW,
    ...over,
  };
}

describe('decisionFor — what the person must decide, from current columns', () => {
  test('plan_created asks for plan approval and links the decision screen', () => {
    expect(decisionFor(task(7, { workflowStatus: 'plan_created' }))).toEqual({
      kind: 'approve_plan',
      link: '/tasks/7/decide',
    });
  });

  test('awaiting_question asks for an answer', () => {
    expect(decisionFor(task(7, { workflowStatus: 'awaiting_question' }))?.kind).toBe(
      'answer_question',
    );
  });

  test('a review hold at verify_done asks for accept/override, with its reason', () => {
    expect(
      decisionFor(
        task(7, { workflowStatus: 'verify_done', haltReason: 'awaiting_review_decision' }),
        'unresolved_dispute',
      ),
    ).toEqual({ kind: 'review_hold', holdReason: 'unresolved_dispute', link: '/tasks/7/decide' });
  });

  test('any other halt asks for a release, carrying the halt code', () => {
    for (const code of ['budget_cost_exceeded', 'no_progress', 'jury_result_discarded']) {
      expect(decisionFor(task(7, { haltReason: code }))).toEqual({
        kind: 'release_halt',
        haltReason: code,
        link: '/tasks/7/decide',
      });
    }
  });

  test('a halt outranks the plan waiting under it', () => {
    const d = decisionFor(task(7, { workflowStatus: 'plan_created', haltReason: 'no_progress' }));
    expect(d?.kind).toBe('release_halt');
  });

  test('a done task or one simply running waits on nobody', () => {
    expect(decisionFor(task(7, { status: 'done', workflowStatus: 'plan_created' }))).toBeNull();
    expect(decisionFor(task(7))).toBeNull();
  });
});

describe('classifyTransition', () => {
  test('names the events the digest counts', () => {
    expect(classifyTransition(tr(1, { cause: 'iteration_budget_halted' }))).toBe('halted');
    expect(classifyTransition(tr(1, { cause: 'adversarial_review_awaiting_human' }))).toBe(
      'review_held',
    );
    expect(classifyTransition(tr(1, { cause: 'verify_repair' }))).toBe('repair');
    expect(classifyTransition(tr(1, { cause: 'requirement_evidence_replan' }))).toBe('replanned');
    expect(classifyTransition(tr(1, { cause: 'plan_revision_requested' }))).toBe('replanned');
    expect(
      classifyTransition(tr(1, { cause: 'file_saved:question', toStatus: 'awaiting_question' })),
    ).toBe('question');
    expect(
      classifyTransition(
        tr(1, { cause: 'file_saved:plan', fromStatus: 'research_done', toStatus: 'plan_created' }),
      ),
    ).toBe('plan_ready');
    expect(classifyTransition(tr(1, { cause: 'halt_released' }))).toBe('decided');
    expect(classifyTransition(tr(1, { cause: 'auto_merged', toStatus: 'completed' }))).toBe(
      'completed',
    );
    expect(classifyTransition(tr(1))).toBe('progress');
  });
});

describe('buildCompanionDigest', () => {
  // Acceptance (stage 2): a task that went to waiting-on-a-person shows what
  // happened, what you decide, and the screen to decide it on.
  test('a task that came to wait on you shows what happened, the decision and the screen', () => {
    const t = task(42, { workflowStatus: 'plan_created' });
    const rows = [
      tr(42, { cause: 'file_saved:research', toStatus: 'research_done' }),
      tr(42, { cause: 'file_saved:plan', fromStatus: 'research_done', toStatus: 'plan_created' }),
    ];
    const digest = buildCompanionDigest(
      input({
        companions: [{ taskId: 42, lastDigestTransitionId: null, startedAt: STARTED }],
        tasks: [t],
        transitions: rows,
      }),
    );
    expect(digest.decisionCount).toBe(1);
    const [item] = digest.items;
    expect(item.taskId).toBe(42);
    expect(item.recent[0].kind).toBe('plan_ready');
    expect(item.decision).toEqual({ kind: 'approve_plan', link: '/tasks/42/decide' });
    expect(item.cursor).toBe(rows[1].id);
    expect(digest.checkedAt).toBe(NOW.toISOString());
  });

  test('only transitions after the cursor are news', () => {
    const old = tr(1, { cause: 'verify_repair' });
    const fresh = tr(1, { cause: 'iteration_budget_halted' });
    const digest = buildCompanionDigest(
      input({
        companions: [{ taskId: 1, lastDigestTransitionId: old.id, startedAt: STARTED }],
        tasks: [task(1, { haltReason: 'no_progress' })],
        transitions: [old, fresh],
      }),
    );
    expect(digest.items[0].since).toEqual({
      transitions: 1,
      halts: 1,
      holds: 0,
      questions: 0,
      repairs: 0,
      replans: 0,
    });
    expect(digest.items[0].cursor).toBe(fresh.id);
  });

  test('without a cursor, news starts at startedAt', () => {
    const before = tr(1, { createdAt: '2026-11-11T23:00:00Z' });
    const after = tr(1, { createdAt: '2026-11-12T01:00:00Z' });
    const digest = buildCompanionDigest(
      input({
        companions: [{ taskId: 1, lastDigestTransitionId: null, startedAt: STARTED }],
        tasks: [task(1)],
        transitions: [before, after],
      }),
    );
    expect(digest.items[0].recent.map((e) => e.id)).toEqual([after.id]);
  });

  test('a decision stays in the digest after it has been seen; a quiet task drops out', () => {
    const seen = tr(1);
    const digest = buildCompanionDigest(
      input({
        companions: [
          { taskId: 1, lastDigestTransitionId: seen.id, startedAt: STARTED },
          { taskId: 2, lastDigestTransitionId: 999_999, startedAt: STARTED },
        ],
        tasks: [task(1, { workflowStatus: 'awaiting_question' }), task(2)],
        transitions: [seen],
      }),
    );
    expect(digest.items.map((i) => i.taskId)).toEqual([1]);
    expect(digest.items[0].since.transitions).toBe(0);
    expect(digest.items[0].cursor).toBeNull();
    expect(digest.items[0].decision?.kind).toBe('answer_question');
  });

  test('blocked shell-call rows are not shown but still advance the cursor', () => {
    const blocked = tr(1, {
      cause: 'plan_approval_blocked',
      toStatus: 'plan_created',
      invariantViolation: true,
    });
    const digest = buildCompanionDigest(
      input({
        companions: [{ taskId: 1, lastDigestTransitionId: null, startedAt: STARTED }],
        tasks: [task(1, { workflowStatus: 'plan_created' })],
        transitions: [blocked],
      }),
    );
    expect(digest.items[0].recent).toEqual([]);
    expect(digest.items[0].cursor).toBe(blocked.id);
  });

  test('waiting tasks come first, then the most recently active', () => {
    const a = tr(1);
    const b = tr(2);
    const digest = buildCompanionDigest(
      input({
        companions: [1, 2, 3].map((taskId) => ({
          taskId,
          lastDigestTransitionId: null,
          startedAt: STARTED,
        })),
        tasks: [task(1), task(2), task(3, { haltReason: 'budget_time_exceeded' })],
        transitions: [a, b],
      }),
    );
    expect(digest.items.map((i) => i.taskId)).toEqual([3, 2, 1]);
  });

  test('carries the repair window total and its most frequent cause', () => {
    const digest = buildCompanionDigest(
      input({
        companions: [{ taskId: 1, lastDigestTransitionId: null, startedAt: STARTED }],
        tasks: [task(1)],
        transitions: [tr(1, { cause: 'verify_repair' })],
        repairs: new Map([
          [1, { capability: 1, infrastructure: 0, requirements: 2, unfounded: 0 }],
        ]),
      }),
    );
    expect(digest.items[0].repairs).toEqual({ total: 3, topCause: 'requirements' });
    expect(digest.items[0].since.repairs).toBe(1);
  });

  test('keeps only the newest few events, newest first', () => {
    const rows = Array.from({ length: MAX_DIGEST_EVENTS + 3 }, () => tr(1));
    const digest = buildCompanionDigest(
      input({
        companions: [{ taskId: 1, lastDigestTransitionId: null, startedAt: STARTED }],
        tasks: [task(1)],
        transitions: rows,
      }),
    );
    expect(digest.items[0].recent.map((e) => e.id)).toEqual(
      rows
        .slice(-MAX_DIGEST_EVENTS)
        .reverse()
        .map((r) => r.id),
    );
    expect(digest.items[0].since.transitions).toBe(rows.length);
  });

  test('a companion whose task row is gone is skipped', () => {
    const digest = buildCompanionDigest(
      input({ companions: [{ taskId: 9, lastDigestTransitionId: null, startedAt: STARTED }] }),
    );
    expect(digest.items).toEqual([]);
  });
});
