/**
 * plan-identity tests
 */
import { describe, expect, test } from 'bun:test';
import { createHash } from 'crypto';
import { planIdentityLine } from './plan-identity';

// 2026-11-23: TempoRaid task 1403's implementer stopped twice to ask whether
// the plan in its prompt was the approved version Rapitas had saved — it had
// no way to tell, so every round needed an operator answer with a hash.
describe('planIdentityLine', () => {
  const plan = '# 計画\n\n- [ ] 一つ目\n';
  const sha = createHash('sha256').update(plan).digest('hex').slice(0, 16);

  test('names the saved approved plan by its hash prefix and length (ja)', () => {
    const line = planIdentityLine(plan, 'ja');
    expect(line).toContain(sha);
    expect(line).toContain(`${plan.length} 文字`);
    expect(line).toContain('保存されている承認済み');
  });

  test('says the same in English', () => {
    const line = planIdentityLine(plan, 'en');
    expect(line).toContain(sha);
    expect(line).toContain(`${plan.length} characters`);
  });

  test('changes when the plan changes', () => {
    expect(planIdentityLine(`${plan}x`, 'ja')).not.toBe(planIdentityLine(plan, 'ja'));
  });
});
