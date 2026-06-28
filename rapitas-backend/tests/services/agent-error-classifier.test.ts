/**
 * Agent Error Classifier テスト
 *
 * Validates that provider-specific failure messages are mapped to the
 * right cooldown reason and reset hint.
 */
import { describe, it, expect, test } from 'bun:test';
import { classifyAgentError } from '../../services/ai/agent-error-classifier';
import { BOUNDARY_STRINGS } from '../helpers/boundary-values';

describe('classifyAgentError', () => {
  it('Codex/ChatGPT の usage limit を quota として判定する', () => {
    const r = classifyAgentError(
      "■ You've hit your usage limit. Upgrade to Pro, visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 1:19 PM.",
    );
    expect(r).not.toBeNull();
    expect(r!.provider).toBe('openai');
    expect(r!.reason).toBe('quota');
    expect(r!.retryWithFallback).toBe(true);
    expect(r!.resetAt).toBeDefined();
  });

  it('try again at HH:MM AM/PM の時刻パースに対応する', () => {
    const r = classifyAgentError('usage limit. try again at 11:30 AM');
    expect(r?.resetAt).toBeDefined();
    expect(r!.resetAt!.getHours()).toBe(11);
    expect(r!.resetAt!.getMinutes()).toBe(30);
  });

  it('Anthropic credit_balance_too_low を quota として判定する', () => {
    const r = classifyAgentError('Anthropic API error: credit_balance_too_low');
    expect(r?.provider).toBe('claude');
    expect(r?.reason).toBe('quota');
  });

  it('Anthropic rate_limit を rate_limit として判定する', () => {
    const r = classifyAgentError('Anthropic API error: rate_limit_error');
    expect(r?.provider).toBe('claude');
    expect(r?.reason).toBe('rate_limit');
  });

  it('rate_limit_error が行頭に来る場合も判定する', () => {
    const r = classifyAgentError('\nrate_limit_error: Request rate limited');
    expect(r?.provider).toBe('claude');
    expect(r?.reason).toBe('rate_limit');
  });

  it('エージェントがコード内で rate_limit_error を使っても誤検知しない', () => {
    // False-positive guard: agents often write code that handles Anthropic
    // rate limit errors — these strings must NOT trigger the fallback path.
    const codeSnippets = [
      "if (error.type === 'rate_limit_error') { handleRateLimit(error); }",
      "case 'rate_limit_error': return retryWithBackoff();",
      "const ERR_RATE_LIMIT = 'rate_limit_error';",
      'I updated the handler to manage rate_limit_error cases properly.',
      '// TODO: handle rate_limit_error from Anthropic',
    ];
    for (const snippet of codeSnippets) {
      const r = classifyAgentError(snippet, { strict: true });
      expect(r).toBeNull();
    }
    // Also check lenient mode — the lenient heuristics should not catch these
    // since none of them have an ERROR context marker at the line beginning.
    for (const snippet of codeSnippets) {
      const r = classifyAgentError(snippet);
      expect(r).toBeNull();
    }
  });

  it('Gemini RESOURCE_EXHAUSTED を quota として判定する', () => {
    const r = classifyAgentError('googleapis: RESOURCE_EXHAUSTED');
    expect(r?.provider).toBe('gemini');
    expect(r?.reason).toBe('quota');
  });

  it('Anthropic invalid api key は auth として判定し fallbackは行わない', () => {
    const r = classifyAgentError('Anthropic API error: invalid api key');
    expect(r?.provider).toBe('claude');
    expect(r?.reason).toBe('auth');
    expect(r?.retryWithFallback).toBe(false);
  });

  it('該当パターンが無い場合は null を返す', () => {
    expect(classifyAgentError('unrelated noise')).toBeNull();
  });

  test.each(BOUNDARY_STRINGS)(
    '境界文字列 $label はパターン不一致で null を返すこと',
    ({ value }) => {
      expect(classifyAgentError(value)).toBeNull();
    },
  );

  it('hint があり 429 ヒントが見つかれば rate_limit として hint プロバイダで分類する', () => {
    const r = classifyAgentError('HTTP 429 Too Many Requests\nERROR: rate limit', 'gemini');
    expect(r?.reason).toBe('rate_limit');
    expect(r?.provider).toBe('gemini');
  });

  describe('strict mode (false-positive prevention)', () => {
    it('strict mode では明示的なルールにマッチしない単語は無視する', () => {
      // 通常モードでは false-positive する文字列
      const innocuous = [
        'Implemented rate limiting on the API endpoints.',
        'Give credit to @ymd for the original idea.',
        'See credit balance section in README.',
      ];
      for (const s of innocuous) {
        // 旧来の lenient モード: 危険な誤検知が起きうる
        // 新しい strict モード: null を返すべき
        expect(classifyAgentError(s, { strict: true })).toBeNull();
      }
    });

    it('strict modeでも明示的なCodex/Claude/Geminiパターンはマッチする', () => {
      const r = classifyAgentError("ERROR: You've hit your usage limit. try again at 1:19 PM", {
        strict: true,
      });
      expect(r).not.toBeNull();
      expect(r!.provider).toBe('openai');
      expect(r!.reason).toBe('quota');
    });

    it('strict modeでも Anthropic credit_balance_too_low はマッチする', () => {
      const r = classifyAgentError('Anthropic API error: credit_balance_too_low', {
        strict: true,
      });
      expect(r?.reason).toBe('quota');
      expect(r?.provider).toBe('claude');
    });

    it('lenient mode (デフォルト) でも、ERRORコンテキストなしの単独 "credit" は誤検知しない（修正後）', () => {
      // 修正前: '\b(quota|usage limit|credit)\b' で単独"credit"が誤検知
      // 修正後: ERRORコンテキスト+具体的なフレーズ要求でこれは null
      expect(classifyAgentError('Give credit to original author')).toBeNull();
      expect(classifyAgentError('Implements rate limiting middleware')).toBeNull();
    });

    it('lenient mode で ERROR文脈 + 明確な quotaフレーズはマッチする', () => {
      const r = classifyAgentError('ERROR: usage limit exceeded for this hour');
      expect(r?.reason).toBe('quota');
    });
  });

  describe('model_unavailable', () => {
    it('Claude Fable 5 is currently unavailable を model_unavailable として判定する', () => {
      const r = classifyAgentError(
        'Claude Fable 5 is currently unavailable. Learn more: https://www.anthropic.com/news/fable-mythos-access',
      );
      expect(r).not.toBeNull();
      expect(r!.provider).toBe('claude');
      expect(r!.reason).toBe('model_unavailable');
      expect(r!.retryWithFallback).toBe(true);
    });

    it('provider クールダウンに入れない（retryWithFallback が true）', () => {
      const r = classifyAgentError('Some model is currently unavailable.');
      expect(r).not.toBeNull();
      expect(r!.retryWithFallback).toBe(true);
    });

    it('unavailable が prose 中に出ても誤検知しない', () => {
      // "currently unavailable" を含まない prose は null
      const r = classifyAgentError('The feature is temporarily unavailable due to maintenance.');
      // "is currently unavailable" のフレーズ要件を満たさないのでマッチしない
      expect(r).toBeNull();
    });
  });
});
