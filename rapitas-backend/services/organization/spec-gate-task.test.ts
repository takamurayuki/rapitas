/**
 * spec-gate-task.test
 *
 * Covers the payload the intake gate files when a document set still carries
 * an error-severity finding. The behaviour that matters is what the task
 * CARRIES: an author who gets "要件定義に不備があります" and no list cannot act,
 * and that is the state this task exists to end.
 */
import { describe, test, expect } from 'bun:test';
import { toSpecGateTaskPayload, SPEC_GATE_TASK_PREFIX } from './spec-gate-task';
import type { SpecFinding } from './spec-consistency';

const error = (code: string, message: string, featureId?: string): SpecFinding => ({
  code,
  severity: 'error',
  message,
  featureId,
});

const warning = (code: string, message: string): SpecFinding => ({
  code,
  severity: 'warning',
  message,
});

describe('toSpecGateTaskPayload', () => {
  test('returns null when nothing is error-severity, so warnings never stop filing', () => {
    expect(
      toSpecGateTaskPayload([warning('too_few_criteria', '受け入れ基準が2件です')], { themeId: 7 }),
    ).toBeNull();
  });

  test('returns null for an empty finding list', () => {
    expect(toSpecGateTaskPayload([], { themeId: 7 })).toBeNull();
  });

  test('carries every error finding, with its feature id, into the description', () => {
    const payload = toSpecGateTaskPayload(
      [
        error('missing_reachability_section', '`# 画面導線` がありません。'),
        error('unreachable_feature', '[F-02] の画面導線がありません。', 'F-02'),
        warning('no_design', '設計書がありません。'),
      ],
      { themeId: 35 },
    );
    expect(payload).not.toBeNull();
    expect(payload?.description).toContain('`# 画面導線` がありません。');
    expect(payload?.description).toContain('[F-02] の画面導線がありません。');
    // The feature id must be visible even when the message is reworded later.
    expect(payload?.description).toContain('F-02');
  });

  test('leaves warnings out of the list, so the author fixes what is blocking', () => {
    const payload = toSpecGateTaskPayload(
      [
        error('no_features', '機能が1件もありません。'),
        warning('no_design', '設計書がありません。'),
      ],
      { themeId: 1 },
    );
    expect(payload?.description).not.toContain('設計書がありません。');
  });

  test('is titled with the prefix the filer dedupes on, and belongs to the theme', () => {
    const payload = toSpecGateTaskPayload([error('no_features', 'x')], { themeId: 42 });
    expect(payload?.title.startsWith(SPEC_GATE_TASK_PREFIX)).toBe(true);
    expect(payload?.themeId).toBe(42);
  });

  test('constrains the work to the documents, since no feature task exists yet', () => {
    const payload = toSpecGateTaskPayload([error('no_features', 'x')], { themeId: 1 });
    const constraints = (payload?.constraints ?? []).join('\n');
    expect(constraints).toContain('docs/');
    // Renumbering would break the [F-NN] ↔ task-title correspondence the
    // filer and spec-drift both rely on.
    expect(constraints).toContain('[F-NN]');
  });

  test('its acceptance criteria are decidable from the document alone', () => {
    const payload = toSpecGateTaskPayload([error('no_features', 'x')], { themeId: 1 });
    expect((payload?.acceptanceCriteria ?? []).length).toBeGreaterThanOrEqual(2);
    for (const c of payload?.acceptanceCriteria ?? []) {
      expect(c).toContain('Given');
      expect(c).toContain('Then');
    }
  });
});
