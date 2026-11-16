/**
 * juror-cli-cooldown テスト
 *
 * 陪審・検証席の補助 CLI 呼び出しの失敗を cooldown に伝える規則（routing2b、
 * 本人判断4）: quota／auth だけ。rate_limit・時間切れ・CLI 以外の失敗は入れない。
 * ベンダーは呼んだ CLI で決め、文言からは推測しない。席の判定は従来どおり
 * unknown。askJuror と askVerifier の本物を通し、sendAIMessage だけを差し替える。
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  ClaudeCliUnavailableError,
  CodexCliUnavailableError,
} from '../../../utils/ai-client/cli-errors';

let failWith: unknown = null;
mock.module('../../../utils/ai-client', () => ({
  sendAIMessage: async () => {
    throw failWith;
  },
  getAuxAiMode: () => 'cli',
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { askJuror, resetJurorHealth } = await import('./juror-call');
const { askVerifier } = await import('./verifier-seat');
const { coolVendorAfterJurorFailure } = await import('./juror-cli-cooldown');
const { __resetCooldowns, listActiveCooldowns } = await import('../../ai/provider-cooldown');

const codexSeat = {
  provider: 'chatgpt' as const,
  model: 'gpt-6-astra',
  label: 'codex:gpt-6-astra',
  cliRoute: 'codex' as const,
};
const claudeSeat = { provider: 'claude' as const, model: 'claude-opus-5-5', label: 'claude:opus' };
const cooled = () => listActiveCooldowns().map((c) => [c.provider, c.reason]);

beforeEach(() => {
  __resetCooldowns();
  resetJurorHealth();
});
afterEach(() => {
  __resetCooldowns();
});

describe('askJuror: 補助 CLI の失敗 → cooldown', () => {
  test('Codex の枠枯渇は openai を quota で休ませ、再開見込みの時刻を持つ', async () => {
    failWith = new CodexCliUnavailableError(
      "Codex CLI exited 1: You've hit your usage limit. Upgrade to Pro, or try again at 3:05 PM.",
    );
    const v = await askJuror(codexSeat, 'prompt');
    expect(v.verdict).toBe('unknown');
    expect(v.unknownReason).toBe('error');
    expect(cooled()).toEqual([['openai', 'quota']]);
    const until = listActiveCooldowns()[0].until;
    // Parsed from "try again at 3:05 PM", not the 1h default.
    expect(new Date(until).getMinutes()).toBe(5);
  });

  test('同じ文言でも Claude CLI が出したなら claude を休ませる（文言で推測しない）', async () => {
    failWith = new ClaudeCliUnavailableError(
      "Claude CLI exited 1: You've hit your usage limit · resets 5pm",
    );
    await askJuror(claudeSeat, 'prompt');
    expect(cooled()).toEqual([['claude', 'quota']]);
  });

  test('未ログインは auth', async () => {
    failWith = new CodexCliUnavailableError('Codex CLI failed: Not logged in. Run codex login.');
    await askJuror(codexSeat, 'prompt');
    expect(cooled()).toEqual([['openai', 'auth']]);
  });

  test('rate_limit・時間切れ・CLI 以外の失敗では休ませない', async () => {
    for (const err of [
      new CodexCliUnavailableError('Codex CLI failed: OpenAI rate limit reached, retry later'),
      new CodexCliUnavailableError('Codex CLI timed out after 120000ms'),
      new ClaudeCliUnavailableError('Claude CLI exited 1: rate_limit_error'),
      new Error("You've hit your usage limit"),
      'not an error',
    ]) {
      failWith = err;
      await askJuror(codexSeat, 'prompt');
    }
    expect(cooled()).toEqual([]);
  });
});

describe('askVerifier: 検証席も同じ規則', () => {
  test('検証席の枠枯渇でも cooldown が付く', async () => {
    failWith = new CodexCliUnavailableError("Codex CLI failed: You've hit your usage limit.");
    const res = await askVerifier(codexSeat, 'prompt', 1);
    expect(res.unknownReason).toBe('error');
    expect(cooled()).toEqual([['openai', 'quota']]);
  });
});

describe('coolVendorAfterJurorFailure', () => {
  test('記録した内容を返し、該当しなければ null', () => {
    expect(
      coolVendorAfterJurorFailure(new CodexCliUnavailableError('Not logged in'), 'gpt-6.1-sol'),
    ).toMatchObject({ provider: 'openai', reason: 'auth' });
    expect(listActiveCooldowns()[0].model).toBe('gpt-6.1-sol');
    expect(coolVendorAfterJurorFailure(new Error('boom'), 'x')).toBeNull();
  });
});
