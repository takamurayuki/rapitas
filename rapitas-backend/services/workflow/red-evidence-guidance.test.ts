/**
 * red-evidence-guidance.test
 *
 * Task 1521 (2026-11-21): the plan said "T1: record RED before the fix,
 * GREEN after". A run made before the fix is a past event nobody can re-run,
 * so every verify round reported "pre-fix history unconfirmed" and the item
 * could never close. RED must be shown in a form anyone can re-run now.
 */
import { describe, expect, test } from 'bun:test';
import { plannerRedEvidenceGuidance, verifierRedEvidenceGuidance } from './red-evidence-guidance';

describe('plannerRedEvidenceGuidance', () => {
  test.each(['ja', 'en'])('asks for RED that can be re-run, not a past run (%s)', (lang) => {
    const text = plannerRedEvidenceGuidance(lang);
    // A disposable copy with the fix removed, or the red-state gate.
    expect(text).toMatch(/使い捨て|disposable/);
    expect(text).toMatch(/red-state/);
    // Never a record of a run made before the fix.
    expect(text).toMatch(/修正前に実行した記録|run made before the fix/);
  });
});

describe('verifierRedEvidenceGuidance', () => {
  test.each(['ja', 'en'])('does not fail a task for a missing past run (%s)', (lang) => {
    const text = verifierRedEvidenceGuidance(lang);
    expect(text).toMatch(/red-state/);
    expect(text).toMatch(/履歴|history/);
    expect(text).toMatch(/❌ にしない|do not mark ❌/i);
  });
});
