/**
 * agent-display-name テスト
 * エージェント種別→表示名変換、レガシー名の書き換え、開発/レビュー判定のテスト
 */
import { describe, test, expect } from 'bun:test';
import {
  getAgentTypeLabel,
  getDefaultAgentName,
  formatAgentDisplayName,
  isDevelopmentAgent,
  isReviewAgent,
} from '../../utils/agent/agent-display-name';

describe('getAgentTypeLabel', () => {
  test('既知のタイプに対応する表示名を返すこと', () => {
    expect(getAgentTypeLabel('claude-code')).toBe('Claude Code');
    expect(getAgentTypeLabel('claude')).toBe('Claude Code');
    expect(getAgentTypeLabel('gemini')).toBe('Gemini');
    expect(getAgentTypeLabel('gemini-cli')).toBe('Gemini');
    expect(getAgentTypeLabel('codex')).toBe('Codex');
    expect(getAgentTypeLabel('codex-cli')).toBe('Codex');
    expect(getAgentTypeLabel('openai')).toBe('OpenAI');
    expect(getAgentTypeLabel('chatgpt')).toBe('OpenAI');
    expect(getAgentTypeLabel('ollama')).toBe('Ollama');
    expect(getAgentTypeLabel('local')).toBe('Local LLM');
  });

  test('未知のタイプは先頭を大文字化して返すこと', () => {
    expect(getAgentTypeLabel('mistral')).toBe('Mistral');
    expect(getAgentTypeLabel('x')).toBe('X');
  });

  test('未知のタイプが既に大文字始まりでもそのまま返すこと', () => {
    expect(getAgentTypeLabel('Custom')).toBe('Custom');
  });

  test('空文字列は Agent にフォールバックすること', () => {
    expect(getAgentTypeLabel('')).toBe('Agent');
  });
});

describe('getDefaultAgentName', () => {
  test('purposeなしの場合はラベルのみ返すこと', () => {
    expect(getDefaultAgentName('claude-code')).toBe('Claude Code');
  });

  test("purpose='review' の場合は (Review) を付与すること", () => {
    expect(getDefaultAgentName('gemini', 'review')).toBe('Gemini (Review)');
  });

  test("purpose='development' の場合はラベルのみ返すこと", () => {
    expect(getDefaultAgentName('codex', 'development')).toBe('Codex');
  });

  test('未知タイプ + review purpose も正しく組み立てること', () => {
    expect(getDefaultAgentName('mistral', 'review')).toBe('Mistral (Review)');
  });
});

describe('formatAgentDisplayName', () => {
  test('空文字列の名前はタイプのラベルにフォールバックすること', () => {
    expect(formatAgentDisplayName('', 'gemini')).toBe('Gemini');
  });

  test('レガシーの Development Agent (type) パターンを書き換えること', () => {
    expect(formatAgentDisplayName('Development Agent (claude-code)', 'ollama')).toBe('Claude Code');
  });

  test('レガシーの Review Agent (type) パターンを書き換えること', () => {
    expect(formatAgentDisplayName('Review Agent (gemini)', 'ollama')).toBe('Gemini (Review)');
  });

  test('レガシーパターンに一致しない名前はそのまま返す（冪等）こと', () => {
    expect(formatAgentDisplayName('Claude Code', 'claude-code')).toBe('Claude Code');
    expect(formatAgentDisplayName('My Custom Agent', 'claude-code')).toBe('My Custom Agent');
  });

  test('括弧内が未知タイプでもラベル化されること', () => {
    expect(formatAgentDisplayName('Development Agent (mistral)', 'claude')).toBe('Mistral');
  });
});

describe('isDevelopmentAgent', () => {
  test('レガシー名パターンで true を返すこと', () => {
    expect(isDevelopmentAgent('Development Agent (claude-code)', null)).toBe(true);
  });

  test("metadata.purpose === 'development' で true を返すこと", () => {
    expect(isDevelopmentAgent('Claude Code', { purpose: 'development' })).toBe(true);
  });

  test('該当しない名前・メタデータでは false を返すこと', () => {
    expect(isDevelopmentAgent('Claude Code', { purpose: 'review' })).toBe(false);
    expect(isDevelopmentAgent('Claude Code', null)).toBe(false);
    expect(isDevelopmentAgent('Claude Code', undefined)).toBe(false);
  });

  test('metadataがオブジェクト以外（文字列・数値）では false を返すこと', () => {
    expect(isDevelopmentAgent('Claude Code', 'development')).toBe(false);
    expect(isDevelopmentAgent('Claude Code', 42)).toBe(false);
  });

  test('空文字列の名前では例外を投げず false を返すこと', () => {
    expect(isDevelopmentAgent('', null)).toBe(false);
  });
});

describe('isReviewAgent', () => {
  test('レガシー名パターンで true を返すこと', () => {
    expect(isReviewAgent('Review Agent (gemini)', null)).toBe(true);
  });

  test("metadata.purpose === 'review' で true を返すこと", () => {
    expect(isReviewAgent('Gemini', { purpose: 'review' })).toBe(true);
  });

  test('該当しない名前・メタデータでは false を返すこと', () => {
    expect(isReviewAgent('Gemini', { purpose: 'development' })).toBe(false);
    expect(isReviewAgent('Gemini', null)).toBe(false);
  });

  test('metadataがオブジェクト以外では false を返すこと', () => {
    expect(isReviewAgent('Gemini', 'review')).toBe(false);
  });
});
