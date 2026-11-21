/**
 * repair-escalation.window.test
 *
 * trendline task 521 (2026-11-21): a Sonnet implementer was rejected for a
 * verified capability gap and the next round ran on gpt-6-astra (premium).
 * Then a question was answered and the task was auto-retried, the escalation
 * count went back to 0, and the third round ran on Sonnet again. Only a change
 * to the work itself (criteria or plan) may reset the escalation.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger, logger: noopLogger }));

type Row = { cause: string; metadata: string; createdAt: Date };
type Activity = { action: string; createdAt: Date };
let transitions: Row[] = [];
let activities: Activity[] = [];

const latest = <T extends { createdAt: Date }>(rows: T[]) =>
  rows.reduce<T | null>((a, r) => (!a || r.createdAt > a.createdAt ? r : a), null);

mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: {
      findMany: async (args: {
        where?: { cause?: { in?: string[] }; createdAt?: { gt?: Date } };
      }) =>
        transitions.filter(
          (t) =>
            (!args.where?.cause?.in || args.where.cause.in.includes(t.cause)) &&
            (!args.where?.createdAt?.gt || t.createdAt > args.where.createdAt.gt),
        ),
      findFirst: async (args: { where?: { cause?: { in?: string[] } } }) =>
        latest(transitions.filter((t) => args.where?.cause?.in?.includes(t.cause))),
    },
    activityLog: {
      findFirst: async (args: { where?: { action?: { in?: string[] } } }) =>
        latest(activities.filter((a) => args.where?.action?.in?.includes(a.action))),
    },
  },
}));

const { summarizeRepairCauses } = await import('./repair-escalation');

const at = (s: number) => new Date(Date.UTC(2026, 10, 21, 0, 0, s));
const capabilityBounce = (s: number): Row => ({
  cause: 'verify_repair',
  metadata: JSON.stringify({ attempt: 1, reason: 'typecheck=NG(3) test=NG(1)' }),
  createdAt: at(s),
});
const mark = (cause: string, s: number): Row => ({ cause, metadata: '{}', createdAt: at(s) });

beforeEach(() => {
  transitions = [];
  activities = [];
});

describe('capability escalation survives events that do not change the work', () => {
  test('an answered question keeps the count', async () => {
    transitions = [capabilityBounce(1), mark('question_resolved', 2)];
    expect((await summarizeRepairCauses(521)).capability).toBe(1);
  });

  test('a manual or automatic retry keeps the count', async () => {
    transitions = [capabilityBounce(1), mark('blocked_auto_retry', 3)];
    activities = [{ action: 'task_retried', createdAt: at(2) }];
    expect((await summarizeRepairCauses(521)).capability).toBe(1);
  });

  test('changed acceptance criteria reset it', async () => {
    transitions = [capabilityBounce(1)];
    activities = [{ action: 'acceptance_criteria_changed', createdAt: at(2) }];
    expect((await summarizeRepairCauses(521)).capability).toBe(0);
  });

  test.each(['plan_invalid_replan', 'plan_revision_requested', 'requirement_evidence_replan'])(
    'a new plan (%s) resets it',
    async (cause) => {
      transitions = [capabilityBounce(1), mark(cause, 2)];
      expect((await summarizeRepairCauses(521)).capability).toBe(0);
    },
  );

  test('a bounce after the reset still counts', async () => {
    transitions = [capabilityBounce(1), mark('plan_invalid_replan', 2), capabilityBounce(3)];
    expect((await summarizeRepairCauses(521)).capability).toBe(1);
  });
});
