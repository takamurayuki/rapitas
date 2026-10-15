import { describe, expect, test } from 'bun:test';
import {
  extractGatePrecisionCases,
  type RepairTransitionRow,
  type TaskAcceptanceSnapshot,
} from './gate-precision-ledger';

const criteria = JSON.stringify([
  '`foo-service.ts` must validate input',
  '`bar-handler.ts` must exist',
]);

function row(overrides: Partial<RepairTransitionRow> & { id: number }): RepairTransitionRow {
  return {
    taskId: 100,
    actor: 'system',
    cause: 'verify_repair',
    toStatus: 'plan_approved',
    metadata: null,
    createdAt: new Date(2026, 8, 1, 0, overrides.id),
    ...overrides,
  };
}

function bounceMeta(reason: string): string {
  return JSON.stringify({ reason });
}

describe('extractGatePrecisionCases', () => {
  test('a single bounce is not a dispute — no output', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'in-progress', acceptanceCriteria: criteria }],
    ]);
    expect(extractGatePrecisionCases({ transitions: rows, tasksById })).toEqual([]);
  });

  test('resolved_by_implementation: 2 bounces then a plain verify_passed', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
      row({ id: 3, cause: 'verify_passed', actor: 'system', toStatus: 'verify_done' }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'todo', acceptanceCriteria: criteria }],
    ]);
    const out = extractGatePrecisionCases({ transitions: rows, tasksById });
    expect(out).toHaveLength(1);
    expect(out[0]!.verdict).toBe('resolved_by_implementation');
    expect(out[0]!.criterionIndex).toBe(1);
    expect(out[0]!.dedupKey).toBe('gate-precision:100:1:2');
  });

  test('resolved_by_human: a manual_ cause sits between the last bounce and the pass', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
      row({ id: 3, cause: 'manual_retry', actor: 'user' }),
      row({ id: 4, cause: 'verify_passed', toStatus: 'verify_done' }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'todo', acceptanceCriteria: criteria }],
    ]);
    const out = extractGatePrecisionCases({ transitions: rows, tasksById });
    expect(out).toHaveLength(1);
    expect(out[0]!.verdict).toBe('resolved_by_human');
  });

  test('resolved_by_human: plan_revision_requested counts even with system actor (the 909 pattern)', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
      row({ id: 3, cause: 'plan_revision_requested', actor: 'system' }),
      row({ id: 4, cause: 'verify_passed', toStatus: 'verify_done' }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'todo', acceptanceCriteria: criteria }],
    ]);
    const out = extractGatePrecisionCases({ transitions: rows, tasksById });
    expect(out[0]!.verdict).toBe('resolved_by_human');
  });

  test('unresolved_blocked: no pass yet and the task is blocked', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'blocked', acceptanceCriteria: criteria }],
    ]);
    const out = extractGatePrecisionCases({ transitions: rows, tasksById });
    expect(out[0]!.verdict).toBe('unresolved_blocked');
  });

  test('still in flight (no pass, not blocked) is skipped — re-evaluated later', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'in-progress', acceptanceCriteria: criteria }],
    ]);
    expect(extractGatePrecisionCases({ transitions: rows, tasksById })).toEqual([]);
  });

  test('no acceptance criteria — skipped entirely', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'blocked', acceptanceCriteria: null }],
    ]);
    expect(extractGatePrecisionCases({ transitions: rows, tasksById })).toEqual([]);
  });

  test('task missing from the snapshot map is skipped', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`foo-service.ts` still missing validation') }),
    ];
    expect(extractGatePrecisionCases({ transitions: rows, tasksById: new Map() })).toEqual([]);
  });

  test('reasons indicting different criteria do not conflate — only the repeated one disputes', () => {
    const rows: RepairTransitionRow[] = [
      row({ id: 1, metadata: bounceMeta('`foo-service.ts` is missing validation') }),
      row({ id: 2, metadata: bounceMeta('`bar-handler.ts` module is missing') }),
    ];
    const tasksById = new Map<number, TaskAcceptanceSnapshot>([
      [100, { id: 100, status: 'blocked', acceptanceCriteria: criteria }],
    ]);
    expect(extractGatePrecisionCases({ transitions: rows, tasksById })).toEqual([]);
  });
});
