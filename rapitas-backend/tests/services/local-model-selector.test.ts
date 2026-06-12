/**
 * local-model-selector テスト
 * インストール済みモデルから最良ローカルモデルを選ぶ純関数の検証。
 */
import { describe, test, expect } from 'bun:test';
import { pickBestLocalModel } from '../../services/local-llm/local-model-selector';

describe('pickBestLocalModel', () => {
  test('falls back to a tiny model when nothing is installed', () => {
    expect(pickBestLocalModel([])).toBe('qwen2.5:0.5b');
  });

  test('prefers a 3B over a 0.5B', () => {
    expect(pickBestLocalModel(['qwen2.5:0.5b', 'qwen2.5:3b-instruct-q4_K_M'])).toBe(
      'qwen2.5:3b-instruct-q4_K_M',
    );
  });

  test('prefers the more capable model by preference order', () => {
    expect(pickBestLocalModel(['llama3.2:1b', 'llama3.1:8b'])).toBe('llama3.1:8b');
  });

  test('matches a bare name against any tag', () => {
    expect(pickBestLocalModel(['llama3.2:latest'])).toBe('llama3.2:latest');
  });

  test('falls back to the first installed model when none are in the preference list', () => {
    expect(pickBestLocalModel(['mistral:7b'])).toBe('mistral:7b');
  });
});
