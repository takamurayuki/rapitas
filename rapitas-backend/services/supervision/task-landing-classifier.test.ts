/**
 * task-landing-classifier tests
 *
 * Every landing class of plan §着地判定の仕様定義 plus the precedence collisions:
 * only a verified, criteria-backed, system-merged top-level task is `qualified`.
 */
import { describe, expect, test } from 'bun:test';
import {
  classifyTaskLanding,
  hasAcceptanceCriteria,
  type LandingTransition,
  type TaskLandingInput,
} from './task-landing-classifier';

const T0 = new Date('2026-09-10T00:00:00Z').getTime();
const at = (minute: number) => new Date(T0 + minute * 60_000);
const tr = (minute: number, cause: string, toStatus = 'in_progress'): LandingTransition => ({
  cause,
  toStatus,
  createdAt: at(minute),
});

/** Completed after a verify pass and auto-merged with a merged mirror row. */
function landed(overrides: Partial<TaskLandingInput> = {}): TaskLandingInput {
  return {
    taskId: 1,
    parentId: null,
    acceptanceCriteriaRaw: '["API returns met"]',
    transitions: [
      tr(0, 'verify_passed'),
      tr(1, 'file_saved:verify', 'completed'),
      tr(10, 'auto_merged'),
    ],
    prState: 'merged',
    autoMergePR: true,
    ...overrides,
  };
}

describe('classifyTaskLanding', () => {
  test('(a) verified + criteria + system merge + merged PR is qualified at merge time', () => {
    const r = classifyTaskLanding(landed());
    expect(r.landingClass).toBe('qualified');
    expect(r.at?.toISOString()).toBe(at(10).toISOString());
    expect(r.reasonCode).toBeNull();
  });

  test('(b) completed at PR creation, open PR, autoMergePR=true is landing_pending', () => {
    const r = classifyTaskLanding(
      landed({ transitions: [tr(0, 'verify_passed'), tr(1, 'x', 'completed')], prState: 'open' }),
    );
    expect(r.landingClass).toBe('landing_pending');
    expect(r.reasonCode).toBe('landing_evidence_pending');
    expect(r.at?.toISOString()).toBe(at(1).toISOString());
  });

  test('(c) same but autoMergePR=false is merge_not_requested', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [tr(0, 'verify_passed'), tr(1, 'x', 'completed')],
        prState: 'open',
        autoMergePR: false,
      }),
    );
    expect(r.landingClass).toBe('merge_not_requested');
  });

  test('(d) merged PR without a system merge transition is manual_merge', () => {
    const r = classifyTaskLanding(
      landed({ transitions: [tr(0, 'verify_passed'), tr(1, 'x', 'completed')] }),
    );
    expect(r.landingClass).toBe('manual_merge');
    expect(r.reasonCode).toBe('recent_intervention');
  });

  test('(e) no verify pass before completion is unverified_completion', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [tr(1, 'x', 'completed'), tr(2, 'verify_passed'), tr(10, 'auto_merged')],
      }),
    );
    expect(r.landingClass).toBe('unverified_completion');
  });

  test('(f) publish after a stop with no verify in between is publish_after_stop', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [
          tr(0, 'verify_passed'),
          tr(1, 'x', 'completed'),
          tr(5, 'auto_run_stop_revert'),
          tr(10, 'auto_merged'),
        ],
      }),
    );
    expect(r.landingClass).toBe('publish_after_stop');
    expect(r.reasonCode).toBe('publish_after_stop_detected');
  });

  test('a fresh verify between the stop and the publish is not publish_after_stop', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [
          tr(0, 'auto_run_stop_revert'),
          tr(2, 'verify_passed'),
          tr(3, 'x', 'completed'),
          tr(10, 'auto_merged'),
        ],
      }),
    );
    expect(r.landingClass).toBe('qualified');
  });

  test('(g) a subtask is never counted', () => {
    expect(classifyTaskLanding(landed({ parentId: 5 })).landingClass).toBe('subtask');
  });

  test.each([['[]'], ['not-json'], [null], ['  ']])(
    '(h) criteria %p is criteria_missing',
    (raw) => {
      const r = classifyTaskLanding(landed({ acceptanceCriteriaRaw: raw }));
      expect(r.landingClass).toBe('criteria_missing');
      expect(r.reasonCode).toBe('acceptance_criteria_missing');
    },
  );

  test('(i) merge exhausted after the last completion with no merge since is landing_failed', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [
          tr(0, 'verify_passed'),
          tr(1, 'x', 'completed'),
          tr(8, 'auto_merge_exhausted'),
        ],
        prState: 'open',
      }),
    );
    expect(r.landingClass).toBe('landing_failed');
  });

  test('exhausted, then merged later, is qualified', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [
          tr(0, 'verify_passed'),
          tr(1, 'x', 'completed'),
          tr(8, 'auto_merge_exhausted'),
          tr(20, 'auto_merge_recovered'),
        ],
      }),
    );
    expect(r.landingClass).toBe('qualified');
    expect(r.at?.toISOString()).toBe(at(20).toISOString());
  });

  test('(j) unreadable automation policy is policy_unreadable', () => {
    const r = classifyTaskLanding(
      landed({
        transitions: [tr(0, 'verify_passed'), tr(1, 'x', 'completed')],
        prState: null,
        autoMergePR: null,
      }),
    );
    expect(r.landingClass).toBe('policy_unreadable');
    expect(r.reasonCode).toBe('landing_evidence_unobservable');
  });

  test('(k) system merge transition without a PR mirror row is landing_pending', () => {
    expect(classifyTaskLanding(landed({ prState: null })).landingClass).toBe('landing_pending');
  });

  test('collision: missing criteria AND unverified resolves to unverified_completion', () => {
    const r = classifyTaskLanding(
      landed({
        acceptanceCriteriaRaw: null,
        transitions: [tr(1, 'x', 'completed'), tr(10, 'auto_merged')],
      }),
    );
    expect(r.landingClass).toBe('unverified_completion');
  });

  test('collision: manual merge AND subtask resolves to manual_merge', () => {
    const r = classifyTaskLanding(
      landed({ parentId: 9, transitions: [tr(0, 'verify_passed'), tr(1, 'x', 'completed')] }),
    );
    expect(r.landingClass).toBe('manual_merge');
  });
});

describe('hasAcceptanceCriteria', () => {
  test('a non-empty JSON array is registered', () => {
    expect(hasAcceptanceCriteria('["a"]')).toBe(true);
    expect(hasAcceptanceCriteria('{"a":1}')).toBe(false);
  });
});
