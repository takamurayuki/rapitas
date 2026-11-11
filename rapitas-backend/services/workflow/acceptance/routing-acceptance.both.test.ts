/**
 * routing-acceptance.both.test — 受け入れテスト H・パターン3（Claude と Codex の両方）
 *
 * 両方の CLI があるホストでは、陪審が CLI ホストでも初めて別系統になる。
 * 席の規則（レビュー席1・検証席は実行役と別系統、レビュー席2はレビュー席1と
 * 別系統を優先）は変えない（本人判断6）。片方が実行中に落ちても、もう片方へ
 * 下限を保って切り替わり、タスクは止まらない。
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  FAIL,
  VERIFY,
  freshState,
  installAcceptanceHarness,
  juryCalls,
  mockCommitSideEffect,
  script,
} from './routing-acceptance.test-helpers';
import { readOutcome, runPostSave, seedVerifiedTask } from './routing-acceptance-flow.test-helpers';
import { failExecutorAndFallback } from './routing-acceptance-executor.test-helpers';

const state = freshState();
const { db, dispose } = installAcceptanceHarness(state);
mockCommitSideEffect(state, await import('../../../routes/workflow/workflow-auto-commit-classify'));
const { runVerifyPostSaveAutomation } =
  await import('../../../routes/workflow/handlers/file-save/verify-post-save-pipeline');
const { __resetCooldowns, listActiveCooldowns, markProviderCooldown } =
  await import('../../ai/provider-cooldown');
const { resetJurorHealth } = await import('../../agents/verification/juror-call');
const { invalidateModelDiscoveryCache } = await import('../../ai/model-discovery');

beforeEach(() => {
  Object.assign(
    state,
    freshState({
      claudeCli: true,
      codexCli: true,
      discovered: {
        claude: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
        openai: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'],
      },
    }),
  );
  __resetCooldowns();
  resetJurorHealth();
  invalidateModelDiscoveryCache();
});
afterAll(dispose);

const seed = (
  executor: string,
  verifier: string,
  agentType: 'claude-code' | 'codex' = 'claude-code',
) => seedVerifiedTask(db, { executorModels: [executor], verifierModel: verifier, agentType });

describe('パターン3 両方', () => {
  test('ケース1 通常完了: sonnet で実装 → レビュー席1 astra（別系統）・席2 opus → completed', async () => {
    const taskId = await seed('claude-sonnet-5-5', 'claude-opus-5-5');
    const result = await runPostSave(runVerifyPostSaveAutomation, db, taskId);
    const out = await readOutcome(db, taskId, state.decisions);
    expect(result.taskMarkedDone).toBe(true);
    expect(out.workflowStatus).toBe('completed');
    // Reviewer-2 leaves reviewer-1's vendor first, then avoids the executor's
    // own model before taking the lower tier (the planner's existing rules).
    expect(juryCalls(state)).toEqual([
      ['codex', 'gpt-6-astra', 'reviewer'],
      ['claude', 'claude-opus-5-5', 'reviewer'],
    ]);
    expect(out.review?.seating?.mode).toBe('cross_vendor');
    expect(out.review?.seating?.seats.map((s) => [s.seatId, s.independence])).toEqual([
      ['reviewer-1', 'cross_vendor'],
      ['reviewer-2', 'context_isolation'],
      ['verifier', 'cross_vendor'],
    ]);
  });

  describe('ケース2 食い違い → 根拠の検証', () => {
    const disputed = (status: 'holds' | 'refuted' | 'undetermined') =>
      script({ reviewers: [FAIL('null 未処理'), undefined!], verifier: VERIFY(status) });

    test('(a) 実行役 Claude: 検証席は astra（別系統）、反証 → completed', async () => {
      state.reply = disputed('refuted');
      const taskId = await seed('claude-sonnet-5-5', 'claude-opus-5-5');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(juryCalls(state).at(-1)).toEqual(['codex', 'gpt-6-astra', 'verifier']);
      expect((await readOutcome(db, taskId)).workflowStatus).toBe('completed');
    });

    test('(b) 実行役 Codex: 検証席は opus、成り立つ → 差し戻し', async () => {
      state.reply = disputed('holds');
      const taskId = await seed('gpt-6.1-sol', 'gpt-6-astra', 'codex');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(juryCalls(state)).toEqual([
        ['claude', 'claude-opus-5-5', 'reviewer'],
        ['codex', 'gpt-6-astra', 'reviewer'],
        ['claude', 'claude-opus-5-5', 'verifier'],
      ]);
      const out = await readOutcome(db, taskId);
      expect(out.workflowStatus).not.toBe('completed');
      expect(out.transitions.map((t) => t.cause)).toContain('verify_repair');
    });

    test('(c) 決められない → 人間へ保留', async () => {
      state.reply = disputed('undetermined');
      const taskId = await seed('claude-sonnet-5-5', 'claude-opus-5-5');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect((await readOutcome(db, taskId)).workflowStatus).not.toBe('completed');
      expect(state.commits).toEqual([]);
    });
  });

  test('ケース3 実装中に Claude が枠切れ: Codex へ下限を保って切り替え、陪審も組み直して完了する', async () => {
    const taskId = await seedVerifiedTask(db, {
      executorModels: [],
      verifierModel: 'gpt-6-astra',
      agentType: 'claude-code',
    });
    const { result, ranModels } = await failExecutorAndFallback(db, {
      taskId,
      failedModel: 'claude-sonnet-5-5',
      agentType: 'claude-code',
      error: "You've hit your usage limit · resets 5pm (claude.ai/settings/usage)",
    });
    expect(result).toMatchObject({ success: true });
    expect(ranModels).toHaveLength(1);
    expect(ranModels[0]).toMatch(/^gpt-/);
    expect(listActiveCooldowns().map((c) => [c.provider, c.reason])).toEqual([['claude', 'quota']]);

    await runPostSave(runVerifyPostSaveAutomation, db, taskId);
    const out = await readOutcome(db, taskId, state.decisions);
    // Two implementer runs: the failed Claude one (no model reported) makes
    // the executor unverified → every seat premium, Claude excluded.
    expect(juryCalls(state)).toEqual([
      ['codex', 'gpt-6-astra', 'reviewer'],
      ['codex', 'gpt-6-astra', 'reviewer'],
    ]);
    expect(out.review?.seating?.unavailable).toEqual(
      expect.arrayContaining([expect.objectContaining({ vendor: 'anthropic', reason: 'quota' })]),
    );
    expect(out.workflowStatus).toBe('completed');
  });

  test('ケース4 レビュー席 ≧ 実行役: astra で実装なら opus／astra。両方使えなければ unmet で下げない', async () => {
    const ok = await seed('gpt-6-astra', 'gpt-6-astra', 'codex');
    await runPostSave(runVerifyPostSaveAutomation, db, ok);
    expect(juryCalls(state).map((c) => c[1])).toEqual(['claude-opus-5-5', 'gpt-6-astra']);

    state.calls.length = 0;
    markProviderCooldown('claude', 'quota');
    markProviderCooldown('openai', 'auth');
    const none = await seed('gpt-6-astra', 'gpt-6-astra', 'codex');
    await runPostSave(runVerifyPostSaveAutomation, db, none);
    const out = await readOutcome(db, none, state.decisions);
    expect(juryCalls(state)).toEqual([]);
    expect(out.review?.seating?.seats).toEqual([]);
    expect(out.review?.seating?.shortfalls).toHaveLength(3);
    expect(out.decisions.some((d) => d.summary === '陪審の席の要件未達')).toBe(true);
  });
});
