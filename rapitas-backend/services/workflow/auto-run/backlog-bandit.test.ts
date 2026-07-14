/**
 * backlog-bandit.test
 *
 * Pure-function coverage for the concern/idea promotion bandit (R6):
 * availability rules, the critical-concern safety override, UCB1 exploration
 * and exploitation, and realized-reward shaping.
 */
import { describe, test, expect } from 'bun:test';
import { selectBacklogArm, realizedReward, type ArmStats } from './backlog-bandit';

const stats = (pulls: number, rewardSum: number): ArmStats => ({ pulls, rewardSum });

describe('selectBacklogArm', () => {
  test('両方空なら null', () => {
    expect(
      selectBacklogArm({
        concern: stats(0, 0),
        idea: stats(0, 0),
        openConcerns: 0,
        openIdeas: 0,
        hasCriticalConcern: false,
      }),
    ).toBeNull();
  });

  test('片方しか在庫がなければその腕', () => {
    expect(
      selectBacklogArm({
        concern: stats(0, 0),
        idea: stats(0, 0),
        openConcerns: 1,
        openIdeas: 0,
        hasCriticalConcern: false,
      }),
    ).toBe('concern');
    expect(
      selectBacklogArm({
        concern: stats(0, 0),
        idea: stats(0, 0),
        openConcerns: 0,
        openIdeas: 1,
        hasCriticalConcern: false,
      }),
    ).toBe('idea');
  });

  test('urgent 懸念があれば実績に関係なく concern（安全側オーバーライド）', () => {
    // Ideas have a perfect record, concerns a terrible one — critical still wins.
    expect(
      selectBacklogArm({
        concern: stats(10, 0),
        idea: stats(10, 10),
        openConcerns: 1,
        openIdeas: 1,
        hasCriticalConcern: true,
      }),
    ).toBe('concern');
  });

  test('実績なし（両腕未試行）は concern にタイブレーク（旧階層の保守的事前分布）', () => {
    expect(
      selectBacklogArm({
        concern: stats(0, 0),
        idea: stats(0, 0),
        openConcerns: 1,
        openIdeas: 1,
        hasCriticalConcern: false,
      }),
    ).toBe('concern');
  });

  test('未試行の腕は探索される（片腕だけ実績あり → 未試行腕が勝つ）', () => {
    expect(
      selectBacklogArm({
        concern: stats(5, 5),
        idea: stats(0, 0),
        openConcerns: 1,
        openIdeas: 1,
        hasCriticalConcern: false,
      }),
    ).toBe('idea');
  });

  test('実績が明確に良い腕を選ぶ（十分な試行後の活用）', () => {
    // concern: 10 pulls all failed; idea: 10 pulls all first-try.
    expect(
      selectBacklogArm({
        concern: stats(10, 0),
        idea: stats(10, 10),
        openConcerns: 1,
        openIdeas: 1,
        hasCriticalConcern: false,
      }),
    ).toBe('idea');
    expect(
      selectBacklogArm({
        concern: stats(10, 10),
        idea: stats(10, 0),
        openConcerns: 1,
        openIdeas: 1,
        hasCriticalConcern: false,
      }),
    ).toBe('concern');
  });
});

describe('realizedReward', () => {
  test('一発完了 = 1.0', () => {
    expect(realizedReward('done', false)).toBe(1.0);
    expect(realizedReward('completed', false)).toBe(1.0);
  });

  test('修復ありの完了 = 0.6', () => {
    expect(realizedReward('done', true)).toBe(0.6);
  });

  test('blocked などの非完了 = 0', () => {
    expect(realizedReward('blocked', false)).toBe(0);
    expect(realizedReward('blocked', true)).toBe(0);
    expect(realizedReward('cancelled', false)).toBe(0);
  });
});
