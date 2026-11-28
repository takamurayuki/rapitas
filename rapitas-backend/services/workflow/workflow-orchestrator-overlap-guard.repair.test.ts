/**
 * workflow-orchestrator-overlap-guard.repair.test
 *
 * 2026-11-28: the overlap guard held 1584 for 1582's PR and 1589 for 1585's
 * PR. Both PRs had a red CI, and their tasks had gone back to work for a CI
 * repair. A PR whose task is back at work will not merge soon, so waiting on
 * it only burned the 30-minute ceiling and kept the head slot idle. Only a PR
 * whose task waits for its merge (verify_done) may hold another implementer.
 */
import { describe, expect, test } from 'bun:test';
import {
  isLinkedPrUnlikelyToMergeSoon,
  makeLinkedPrStateReader,
} from './overlap-guard-merge-state';

describe('isLinkedPrUnlikelyToMergeSoon', () => {
  test.each([
    'draft',
    'research_done',
    'plan_created',
    'plan_approved',
    'in_progress',
    'awaiting_question',
  ])('a task back at work (%s) does not hold others', (workflowStatus) => {
    expect(
      isLinkedPrUnlikelyToMergeSoon({ workflowStatus, status: 'in-progress' }, undefined),
    ).toBe(true);
  });

  test('a task waiting for its merge (verify_done) still holds others', () => {
    expect(
      isLinkedPrUnlikelyToMergeSoon(
        { workflowStatus: 'verify_done', status: 'in-progress' },
        undefined,
      ),
    ).toBe(false);
  });

  test('a blocked task does not hold others', () => {
    expect(
      isLinkedPrUnlikelyToMergeSoon(
        { workflowStatus: 'verify_done', status: 'blocked' },
        undefined,
      ),
    ).toBe(true);
  });

  test('a parked merge outcome does not hold others (existing rule kept)', () => {
    expect(
      isLinkedPrUnlikelyToMergeSoon(
        { workflowStatus: 'verify_done', status: 'in-progress' },
        'auto_merge_exhausted',
      ),
    ).toBe(true);
    expect(
      isLinkedPrUnlikelyToMergeSoon(
        { workflowStatus: 'verify_done', status: 'in-progress' },
        'auto_merged',
      ),
    ).toBe(false);
  });

  test('an unreadable task keeps the hold (fail toward waiting, as before)', () => {
    expect(isLinkedPrUnlikelyToMergeSoon(null, undefined)).toBe(false);
  });
});

describe('makeLinkedPrStateReader — the default reader the guard uses', () => {
  const fakeDb = (
    task: { workflowStatus: string | null; status: string } | null,
    cause?: string,
  ) => ({
    task: { findUnique: async () => task },
    workflowTransition: { findFirst: async () => (cause ? { cause } : null) },
  });

  test('reads the linked task and its latest merge outcome', async () => {
    const read = makeLinkedPrStateReader(async () =>
      fakeDb({ workflowStatus: 'plan_approved', status: 'in-progress' }),
    );
    expect(await read(1585)).toBe(true);
  });

  test('a task waiting for merge with no outcome yet holds', async () => {
    const read = makeLinkedPrStateReader(async () =>
      fakeDb({ workflowStatus: 'verify_done', status: 'in-progress' }),
    );
    expect(await read(1585)).toBe(false);
  });

  test('an exhausted outcome still parks the PR', async () => {
    const read = makeLinkedPrStateReader(async () =>
      fakeDb({ workflowStatus: 'verify_done', status: 'in-progress' }, 'auto_merge_exhausted'),
    );
    expect(await read(1585)).toBe(true);
  });
});
