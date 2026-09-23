/**
 * workflow-mode-directives.test
 *
 * The lightweight directives exist to override the plan-centric role prompts.
 * Task 1040 (2026-09-23) showed the gap: the researcher seed prompt demands a
 * 「未確定事項（プランナーが解決すべき項目）」 section, the researcher dutifully
 * listed options A/B/C for a planner that never runs, the implementer shipped
 * only one option's diagnostics, and verification bounced the task for the
 * undecided acceptance criterion. These tests pin the wording that closes it.
 */
import { describe, test, expect } from 'bun:test';
import { applyPlanModeDirective, researchModeDirective } from './workflow-mode-directives';

describe('researchModeDirective (lightweight)', () => {
  test('未確定事項を研究者自身が決定するよう指示する (ja)', () => {
    const d = researchModeDirective('lightweight', 'ja');
    expect(d).toContain('未確定事項');
    expect(d).toContain('解決する人がいません');
    expect(d).toContain('最終判定');
    expect(d).toContain('採用: X');
  });

  test('判定を求める受入基準は research.md の必須成果物と明記する (ja)', () => {
    const d = researchModeDirective('lightweight', 'ja');
    expect(d).toContain('欠陥か正常動作かの判定');
    expect(d).toContain('必須成果物');
  });

  test('English variant carries the same decision rule', () => {
    const d = researchModeDirective('lightweight', 'en');
    expect(d).toContain('nobody to resolve it');
    expect(d).toContain('Decision: X');
    expect(d).toContain('required deliverable');
  });

  test('plan modes keep deferring detail to the planner', () => {
    expect(researchModeDirective('standard', 'ja')).toContain('計画フェーズに委ねて');
    expect(researchModeDirective('comprehensive', 'en')).toContain('left to the plan phase');
    expect(researchModeDirective('standard', 'ja')).not.toContain('解決する人がいません');
  });
});

describe('applyPlanModeDirective (implementer, no plan)', () => {
  test('未決の未確定事項があっても止まらず選んで根拠を残すよう指示する', () => {
    const out = applyPlanModeDirective('implementer', 'ROLE', false);
    expect(out).toContain('決定の無い項目が残っていても');
    expect(out).toContain('一部だけ実装したりしないでください');
    expect(out).toContain('NOTE コメント');
    expect(out.endsWith('ROLE')).toBe(true);
  });

  test('with a plan the implementer is told to follow plan.md instead', () => {
    const out = applyPlanModeDirective('implementer', 'ROLE', true);
    expect(out).toContain('承認済みの plan.md');
    expect(out).not.toContain('決定の無い項目');
  });

  test('other roles are untouched', () => {
    expect(applyPlanModeDirective('researcher', 'ROLE', false)).toBe('ROLE');
    expect(applyPlanModeDirective('planner', 'ROLE', true)).toBe('ROLE');
  });
});
