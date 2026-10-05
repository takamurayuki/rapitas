import { expect, test } from 'bun:test';
import { buildReplanReviewInput, REPLAN_REVIEW_PROMPT } from './requirement-replan-prompt';

/**
 * task 1105: 受入基準「マージが成功する」は verify 後の system 所有ステージ
 * (PR 作成 / CI / マージ、completion gate が verify_awaiting_required_merge で
 * 保留して強制する)で満たされる。plan がそこへ委譲すると所有関係の記述なのに
 * 「要件の除外」と読まれ requirement_evidence_replan で差し戻された。対照:
 * 同じ基準でも plan の無い軽量モード(1104)は差し戻し 0。
 */
test('tells the reviewer that deferring to an enforced post-verify stage is not a waiver', () => {
  expect(REPLAN_REVIEW_PROMPT).toContain('verify_awaiting_required_merge');
  expect(REPLAN_REVIEW_PROMPT).toContain('verify_pr_not_created');
  // The allowance must stay conditional — dropping the requirement is still a contradiction.
  expect(REPLAN_REVIEW_PROMPT).toContain('drops it outright');
});

test('preserves requirements and artifact tails without truncation', () => {
  const snapshot = {
    title: 'test',
    description: 'x'.repeat(3100) + '末尾訂正',
    goals: ['goal'],
    constraints: ['禁止事項'],
    acceptanceCriteria: ['条件'],
    plan: 'p'.repeat(17000) + '末尾の非対象',
    verify: '失敗証拠',
  };
  const input = JSON.parse(buildReplanReviewInput(snapshot)!);
  const { requirementSources, currentPlanAuthority, ...original } = input;
  expect(typeof currentPlanAuthority).toBe('string');
  expect(requirementSources.description.join('\n')).toBe(snapshot.description);
  expect(requirementSources.acceptanceCriteria).toEqual(snapshot.acceptanceCriteria);
  expect({
    ...original,
    plan: input.plan.map((r: { text: string }) => r.text).join('\n'),
    verify: input.verify.map((r: { text: string }) => r.text).join('\n'),
  }).toEqual(snapshot);
  expect(buildReplanReviewInput({ ...snapshot, plan: 'p'.repeat(100001) })).toBeNull();
});
