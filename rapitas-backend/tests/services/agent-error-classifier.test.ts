/**
 * Agent Error Classifier テスト
 *
 * Validates that provider-specific failure messages are mapped to the
 * right cooldown reason and reset hint.
 */
import { describe, it, expect } from 'bun:test';
import { classifyAgentError } from '../../services/ai/agent-error-classifier';

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
    expect(classifyAgentError('')).toBeNull();
  });

  it('hint があり 429 ヒントが見つかれば rate_limit として hint プロバイダで分類する', () => {
    const r = classifyAgentError('HTTP 429 Too Many Requests', 'gemini');
    expect(r?.reason).toBe('rate_limit');
    expect(r?.provider).toBe('gemini');
  });
});
