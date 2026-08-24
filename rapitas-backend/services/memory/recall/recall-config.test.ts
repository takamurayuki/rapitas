/**
 * recall-config テスト
 *
 * 既定値・不正値の個別フォールバック・部分指定の重み・キャッシュ再読込を検証する。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { parseRecallConfig, getRecallConfig, resetRecallConfigCache } from './recall-config';

afterEach(() => {
  resetRecallConfigCache();
  delete process.env.RAPITAS_KB_RECALL_STAGES;
});

describe('parseRecallConfig', () => {
  test('空の env なら既定値を返す', () => {
    const cfg = parseRecallConfig({});
    expect(cfg.stages).toEqual(['active', 'dormant', 'archived']);
    expect(cfg.stageWeights).toEqual({ active: 1, dormant: 0.85, archived: 0.6 });
    expect(cfg.minSimilarity).toBe(0.55);
    expect(cfg.maxEntries).toBe(6);
    expect(cfg.candidateMultiplier).toBe(5);
    expect(cfg.lexicalEnabled).toBe(true);
    expect(cfg.lexicalMinScore).toBe(0.15);
    expect(cfg.lexicalIndexTtlMs).toBe(600_000);
  });

  test('不正なステージ名は無視され、有効なものだけ残る', () => {
    const cfg = parseRecallConfig({ RAPITAS_KB_RECALL_STAGES: 'archived,bogus' });
    expect(cfg.stages).toEqual(['archived']);
  });

  test('ステージが全て不正なら既定へ戻る', () => {
    const cfg = parseRecallConfig({ RAPITAS_KB_RECALL_STAGES: 'nope,,x' });
    expect(cfg.stages).toEqual(['active', 'dormant', 'archived']);
  });

  test('重みは部分指定でき、未指定キーは既定を保つ', () => {
    const cfg = parseRecallConfig({ RAPITAS_KB_RECALL_STAGE_WEIGHTS: 'archived=0.3,dormant=abc' });
    expect(cfg.stageWeights).toEqual({ active: 1, dormant: 0.85, archived: 0.3 });
  });

  test('範囲外の数値は該当項目のみ既定へ戻り他は反映される', () => {
    const cfg = parseRecallConfig({
      RAPITAS_KB_RECALL_MIN_SIMILARITY: '1.5',
      RAPITAS_KB_RECALL_MAX_ENTRIES: '4',
      RAPITAS_KB_RECALL_CANDIDATE_MULTIPLIER: '-1',
      RAPITAS_KB_RECALL_LEXICAL_MIN_SCORE: '0.25',
    });
    expect(cfg.minSimilarity).toBe(0.55);
    expect(cfg.maxEntries).toBe(4);
    expect(cfg.candidateMultiplier).toBe(5);
    expect(cfg.lexicalMinScore).toBe(0.25);
  });

  test('語彙チャネルは 0/false/off で無効化できる', () => {
    expect(parseRecallConfig({ RAPITAS_KB_RECALL_LEXICAL: '0' }).lexicalEnabled).toBe(false);
    expect(parseRecallConfig({ RAPITAS_KB_RECALL_LEXICAL: 'off' }).lexicalEnabled).toBe(false);
    expect(parseRecallConfig({ RAPITAS_KB_RECALL_LEXICAL: '1' }).lexicalEnabled).toBe(true);
  });
});

describe('getRecallConfig', () => {
  test('初回に process.env を読み、reset 後は再読込する', () => {
    process.env.RAPITAS_KB_RECALL_STAGES = 'active';
    expect(getRecallConfig().stages).toEqual(['active']);
    process.env.RAPITAS_KB_RECALL_STAGES = 'dormant';
    expect(getRecallConfig().stages).toEqual(['active']);
    resetRecallConfigCache();
    expect(getRecallConfig().stages).toEqual(['dormant']);
  });
});
