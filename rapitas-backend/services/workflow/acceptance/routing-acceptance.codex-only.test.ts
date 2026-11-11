/**
 * routing-acceptance.codex-only.test — 受け入れテスト H・パターン2（Codex だけ）
 *
 * Codex CLI（ChatGPT ログイン）だけがあるホスト。陪審の席は OpenAI の行に
 * Codex 経路で座り、Claude CLI には一度も回らない（haiku に化けない回帰）。
 * Codex が枠切れになったら、止まった理由と再開見込みを表示・記録し、cooldown
 * が明けたら再開する。黙って基準を下げない（本人判断3）。
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  ClaudeCliUnavailableError,
  CodexCliUnavailableError,
} from '../../../utils/ai-client/cli-errors';
import {
  FAIL,
  VERIFY,
  freshState,
  installAcceptanceHarness,
  juryCalls,
  mockCommitSideEffect,
  script,
  type AcceptanceState,
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

const OPENAI_MODELS = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'];

/** No Claude CLI on this host: anything sent to it fails like a missing binary. */
const codexOnly =
  (reply: AcceptanceState['reply']): AcceptanceState['reply'] =>
  (call) =>
    call.route === 'claude'
      ? new ClaudeCliUnavailableError('Claude CLI spawn failed: ENOENT')
      : reply(call);

beforeEach(() => {
  Object.assign(
    state,
    freshState({
      claudeCli: false,
      codexCli: true,
      discovered: { claude: [], openai: OPENAI_MODELS },
      reply: codexOnly(script({})),
    }),
  );
  __resetCooldowns();
  resetJurorHealth();
  invalidateModelDiscoveryCache();
});
afterAll(dispose);

const seed = (executor: string, verifier = 'gpt-6-astra') =>
  seedVerifiedTask(db, { executorModels: [executor], verifierModel: verifier, agentType: 'codex' });

describe('パターン2 Codex だけ', () => {
  test('ケース1 通常完了: sol で実装 → astra で検証 → astra／sol が Codex 経路で合格 → completed', async () => {
    const taskId = await seed('gpt-6.1-sol');
    const result = await runPostSave(runVerifyPostSaveAutomation, db, taskId);
    const out = await readOutcome(db, taskId, state.decisions);
    expect(result.taskMarkedDone).toBe(true);
    expect(out.workflowStatus).toBe('completed');
    expect(juryCalls(state)).toEqual([
      ['codex', 'gpt-6-astra', 'reviewer'],
      ['codex', 'gpt-6.1-sol', 'reviewer'],
    ]);
    // Regression: no jury call ever reaches the Claude CLI (the old haiku route).
    expect(state.calls.filter((c) => c.route === 'claude' && c.seat !== 'other')).toEqual([]);
    expect(out.review?.seats.map((s) => [s.seatId, s.provider, s.model])).toEqual([
      ['reviewer-1', 'chatgpt', 'gpt-6-astra'],
      ['reviewer-2', 'chatgpt', 'gpt-6.1-sol'],
    ]);
    expect(out.review?.seating?.mode).toBe('single_vendor');
  });

  describe('ケース2 食い違い → 根拠の検証（検証席 astra）', () => {
    const disputed = (status: 'holds' | 'refuted' | 'undetermined') =>
      codexOnly(script({ reviewers: [FAIL('null 未処理'), undefined!], verifier: VERIFY(status) }));

    test('(a) 反証 → completed', async () => {
      state.reply = disputed('refuted');
      const taskId = await seed('gpt-6.1-sol');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(juryCalls(state).at(-1)).toEqual(['codex', 'gpt-6-astra', 'verifier']);
      expect((await readOutcome(db, taskId)).workflowStatus).toBe('completed');
    });

    test('(b) 成り立つ → 実装役へ差し戻し', async () => {
      state.reply = disputed('holds');
      const taskId = await seed('gpt-6.1-sol');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      const out = await readOutcome(db, taskId);
      expect(out.workflowStatus).not.toBe('completed');
      expect(out.transitions.map((t) => t.cause)).toContain('verify_repair');
      expect(state.commits).toEqual([]);
    });

    test('(c) 決められない → 人間へ保留', async () => {
      state.reply = disputed('undetermined');
      const taskId = await seed('gpt-6.1-sol');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect((await readOutcome(db, taskId)).workflowStatus).not.toBe('completed');
      expect(state.commits).toEqual([]);
    });
  });

  describe('ケース3 唯一のベンダーが落ちる', () => {
    test('実行中に Codex が枠切れ: 切替を断り、理由と再開見込みを残し、明けたら再開する', async () => {
      const taskId = await seed('gpt-6.1-sol');
      const { result, ranModels } = await failExecutorAndFallback(db, {
        taskId,
        failedModel: 'gpt-6.1-sol',
        agentType: 'codex',
        error:
          "You've hit your usage limit. Visit chatgpt.com/codex/settings/usage, or try again at 4:40 PM.",
      });
      expect(result).toBeNull();
      expect(ranModels).toEqual([]);
      const cooldown = listActiveCooldowns().find((c) => c.provider === 'openai');
      expect(cooldown?.reason).toBe('quota');

      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      const stopped = await readOutcome(db, taskId, state.decisions);
      // Nothing is asked — not Codex (cooling), and never the Claude CLI instead.
      expect(juryCalls(state)).toEqual([]);
      expect(stopped.review?.seating?.shortfalls.map((s) => s.seatId)).toEqual([
        'reviewer-1',
        'reviewer-2',
        'verifier',
      ]);
      expect(stopped.review?.seating?.unavailable).toEqual(
        expect.arrayContaining([
          { vendor: 'openai', reason: 'quota', resumeAt: new Date(cooldown!.until).toISOString() },
        ]),
      );
      const unmet = stopped.decisions.find((d) => d.summary === '陪審の席の要件未達');
      expect(unmet?.adoptedReason).toContain('openai: quota（再開見込み');

      __resetCooldowns();
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      // The failed run reported no model, so the executor is unverified (premium).
      expect(juryCalls(state)).toEqual([
        ['codex', 'gpt-6-astra', 'reviewer'],
        ['codex', 'gpt-6-astra', 'reviewer'],
      ]);
    });

    test('陪審の呼び出しが枠切れ（quota）なら openai を休ませ、次のレビューは全席 unmet', async () => {
      state.reply = codexOnly(
        script({
          reviewers: [
            new CodexCliUnavailableError("Codex CLI failed: You've hit your usage limit."),
            new CodexCliUnavailableError("Codex CLI failed: You've hit your usage limit."),
          ],
        }),
      );
      const taskId = await seed('gpt-6.1-sol');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(listActiveCooldowns().map((c) => [c.provider, c.reason])).toEqual([
        ['openai', 'quota'],
      ]);
      state.calls.length = 0;
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(juryCalls(state)).toEqual([]);
    });

    test('陪審の呼び出しの rate_limit では休ませない', async () => {
      state.reply = codexOnly(
        script({
          reviewers: [
            new CodexCliUnavailableError('Codex CLI failed: OpenAI rate limit reached'),
            undefined!,
          ],
        }),
      );
      const taskId = await seed('gpt-6.1-sol');
      await runPostSave(runVerifyPostSaveAutomation, db, taskId);
      expect(listActiveCooldowns()).toEqual([]);
    });
  });

  test('ケース4 レビュー席 ≧ 実行役: astra で実装ならレビュー席2も astra。sol の検証フェーズは保留', async () => {
    const ok = await seed('gpt-6-astra');
    await runPostSave(runVerifyPostSaveAutomation, db, ok);
    expect(juryCalls(state).map((c) => c[1])).toEqual(['gpt-6-astra', 'gpt-6-astra']);

    state.calls.length = 0;
    const held = await seed('gpt-6-astra', 'gpt-6.1-sol');
    await runPostSave(runVerifyPostSaveAutomation, db, held);
    expect((await readOutcome(db, held)).workflowStatus).not.toBe('completed');
    expect(juryCalls(state)).toEqual([]);
    expect(state.commits).toEqual([ok]);
  });
});
