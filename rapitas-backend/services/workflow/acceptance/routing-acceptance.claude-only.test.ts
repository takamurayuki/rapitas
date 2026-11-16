/**
 * routing-acceptance.claude-only.test — 受け入れテスト H・パターン1（Claude だけ）
 *
 * Claude Code CLI だけがあるホストで、実行 → 検証 → レビュー → 完了を本番の
 * モジュールのまま通す（境界は routing-acceptance.test-helpers.ts）。
 * 実行記録は実 SQLite、保存後のパイプライン（完了ゲート → 陪審 → commit）は実物。
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
const { __resetCooldowns, listActiveCooldowns } = await import('../../ai/provider-cooldown');
const { resetJurorHealth } = await import('../../agents/verification/juror-call');
const { invalidateModelDiscoveryCache } = await import('../../ai/model-discovery');

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

beforeEach(() => {
  Object.assign(
    state,
    freshState({
      claudeCli: true,
      codexCli: false,
      discovered: { claude: CLAUDE_MODELS, openai: [] },
    }),
  );
  __resetCooldowns();
  resetJurorHealth();
  invalidateModelDiscoveryCache();
});
afterAll(dispose);

const seed = (executor: string, verifier = 'claude-opus-5-5') =>
  seedVerifiedTask(db, { executorModels: [executor], verifierModel: verifier });

describe('パターン1 Claude だけ', () => {
  test('ケース1 通常完了: sonnet で実装 → opus で検証 → opus／sonnet が合格 → completed', async () => {
    const taskId = await seed('claude-sonnet-5-5');
    const result = await runPostSave(runVerifyPostSaveAutomation, db, taskId);
    const out = await readOutcome(db, taskId, state.decisions);
    expect(result.taskMarkedDone).toBe(true);
    expect(out.workflowStatus).toBe('completed');
    expect(state.commits).toEqual([taskId]);
    expect(juryCalls(state)).toEqual([
      ['claude', 'claude-opus-5-5', 'reviewer'],
      ['claude', 'claude-sonnet-5-5', 'reviewer'],
    ]);
    expect(out.review?.seating?.mode).toBe('single_vendor');
    expect(out.review?.seating?.shortfalls).toEqual([]);
    expect(out.review?.seating?.seats.every((s) => s.independence === 'context_isolation')).toBe(
      true,
    );
  });

  describe('ケース2 食い違い → 根拠の検証（検証席 opus）', () => {
    test('(a) 指摘が反証される → completed', async () => {
      state.reply = script({
        reviewers: [FAIL('null 未処理'), undefined!],
        verifier: VERIFY('refuted'),
      });
      const taskId = await seed('claude-sonnet-5-5');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(juryCalls(state).at(-1)).toEqual(['claude', 'claude-opus-5-5', 'verifier']);
      expect((await readOutcome(db, taskId, state.decisions)).workflowStatus).toBe('completed');
    });

    test('(b) 指摘が成り立つ → 実装役へ差し戻し（完了しない・commit しない）', async () => {
      state.reply = script({
        reviewers: [FAIL('null 未処理'), undefined!],
        verifier: VERIFY('holds'),
      });
      const taskId = await seed('claude-sonnet-5-5');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      const out = await readOutcome(db, taskId, state.decisions);
      expect(out.workflowStatus).not.toBe('completed');
      expect(state.commits).toEqual([]);
      expect(out.transitions.map((t) => t.cause)).toContain('verify_repair');
    });

    test('(c) 決められない → 人間へ保留（完了しない）', async () => {
      state.reply = script({
        reviewers: [FAIL('null 未処理'), undefined!],
        verifier: VERIFY('undetermined'),
      });
      const taskId = await seed('claude-sonnet-5-5');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      const out = await readOutcome(db, taskId, state.decisions);
      expect(out.workflowStatus).not.toBe('completed');
      expect(state.commits).toEqual([]);
      expect(out.review?.jurors.map((j) => j.verdict)).toEqual(['fail', 'pass', expect.anything()]);
    });
  });

  test('ケース3 実行中に Claude が枠切れ: 代わりが無いので切替を断り、理由と再開見込みを残す', async () => {
    const taskId = await seed('claude-sonnet-5-5');
    const { result, ranModels } = await failExecutorAndFallback(db, {
      taskId,
      failedModel: 'claude-sonnet-5-5',
      agentType: 'claude-code',
      error: "You've hit your usage limit · try again at 3:05 PM (claude.ai/settings/usage)",
    });
    expect(result).toBeNull();
    expect(ranModels).toEqual([]);
    const cooldown = listActiveCooldowns().find((c) => c.provider === 'claude');
    expect(cooldown?.reason).toBe('quota');
    expect(new Date(cooldown!.until).getMinutes()).toBe(5);
    const out = await readOutcome(db, taskId, state.decisions);
    const refusal = out.decisions.find((d) => d.summary.startsWith('プロバイダフォールバック'));
    expect(refusal?.input.constraintsApplied).toBe(false);
    // The jury on this host now has no vendor: seats stay unmet with the
    // reason and the expected resume time, never filled by anything lower.
    await runPostSave(runVerifyPostSaveAutomation, db, taskId);
    const after = await readOutcome(db, taskId, state.decisions);
    expect(juryCalls(state)).toEqual([]);
    expect(after.review?.seating?.unavailable).toEqual(
      expect.arrayContaining([
        { vendor: 'anthropic', reason: 'quota', resumeAt: new Date(cooldown!.until).toISOString() },
        { vendor: 'openai', reason: 'Codex CLI が見つからない・起動しない' },
      ]),
    );
    const unmet = after.decisions.find((d) => d.summary === '陪審の席の要件未達');
    expect(unmet?.adoptedReason).toContain('再開見込み');
    // Once the cooldown is over the same host seats its jury again (再開).
    __resetCooldowns();
    await runPostSave(runVerifyPostSaveAutomation, db, taskId);
    expect(juryCalls(state).map((c) => c[1])).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
  });

  test('ケース4 レビュー席 ≧ 実行役: opus で実装なら両席 opus。検証フェーズが sonnet なら保留', async () => {
    const ok = await seed('claude-opus-5-5', 'claude-opus-5-5');
    await runPostSave(runVerifyPostSaveAutomation, db, ok);
    expect(juryCalls(state).map((c) => c[1])).toEqual(['claude-opus-5-5', 'claude-opus-5-5']);
    expect(
      (await readOutcome(db, ok, state.decisions)).review?.seating?.seats.map(
        (s) => s.requiredTier,
      ),
    ).toEqual(['premium', 'premium', 'premium']);

    state.calls.length = 0;
    const held = await seed('claude-opus-5-5', 'claude-sonnet-5-5');
    await runPostSave(runVerifyPostSaveAutomation, db, held);
    const out = await readOutcome(db, held, state.decisions);
    expect(out.workflowStatus).not.toBe('completed');
    expect(state.commits).toEqual([ok]);
    // The completion gate stops before the jury: nobody is asked.
    expect(juryCalls(state)).toEqual([]);
  });
});
