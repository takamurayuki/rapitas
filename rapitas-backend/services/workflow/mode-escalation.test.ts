/**
 * mode-escalation.test
 *
 * A lightweight task skips the plan phase, so anything research could not
 * settle reaches the implementer unplanned. Measured 2026-11-20 over 45 days:
 * lightweight tasks bounced 1.5–1.8 times each at verify, standard 36–50 only
 * 1.1. Task 1508 (complexity 18) is the shape: its research listed
 * 「未確定事項（プランナーが解決すべき項目）」 and failed the research critic once,
 * yet ran with no planner.
 */
import { describe, expect, test } from 'bun:test';
import { countOpenItems, decideEscalation } from './mode-escalation';

const research = (openItems: string) => `# タスク調査レポート
## 前提監査
- 再現する

## 未確定事項（プランナーが解決すべき項目）
${openItems}

## 複雑度評価
スコア: 18
`;

describe('countOpenItems', () => {
  test('counts bullets and table rows under the open-items heading', () => {
    expect(countOpenItems(research('- A を確かめる\n- B を確かめる'))).toBe(2);
    expect(
      countOpenItems(research('| 項目 | 理由 |\n| --- | --- |\n| A | x |\n| B | y |\n| C | z |')),
    ).toBe(3);
  });

  test('"なし" or an empty section is zero', () => {
    expect(countOpenItems(research('なし'))).toBe(0);
    expect(countOpenItems(research('- なし'))).toBe(0);
    expect(countOpenItems(research(''))).toBe(0);
    expect(countOpenItems('# no such section')).toBe(0);
  });

  test('stops at the next heading', () => {
    expect(countOpenItems(research('- A') + '\n## 使用知識\n- unrelated')).toBe(1);
  });
});

describe('decideEscalation', () => {
  const none = { criticFailed: false, openItems: 0, criteriaAutoFixed: false };

  test('no signal keeps lightweight', () => {
    expect(decideEscalation('lightweight', none, true)).toEqual({
      mode: 'lightweight',
      reasons: [],
    });
  });

  test('any signal promotes lightweight to standard and says why', () => {
    const r = decideEscalation(
      'lightweight',
      { criticFailed: true, openItems: 2, criteriaAutoFixed: true },
      true,
    );
    expect(r.mode).toBe('standard');
    expect(r.reasons).toEqual(['research_critic_failed', 'open_items:2', 'criteria_auto_fixed']);
  });

  test('never touches standard or comprehensive', () => {
    const signals = { criticFailed: true, openItems: 3, criteriaAutoFixed: true };
    expect(decideEscalation('standard', signals, true).mode).toBe('standard');
    expect(decideEscalation('comprehensive', signals, true).mode).toBe('comprehensive');
  });

  test('stays lightweight when standard is disabled', () => {
    const r = decideEscalation('lightweight', { ...none, openItems: 1 }, false);
    expect(r.mode).toBe('lightweight');
  });
});
