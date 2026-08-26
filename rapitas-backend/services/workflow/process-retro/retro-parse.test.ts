/**
 * retro-parse ユニットテスト
 *
 * AI出力のパース(fail-open)・finding単位の検証破棄・slug正規化・
 * 起票選別(systemic/severity閾値/最大2件/安定順)・dedupKey生成を検証する。
 */
import { describe, test, expect } from 'bun:test';
import {
  MAX_RETRO_CONCERNS,
  RETRO_CATEGORIES,
  buildDedupKey,
  normalizeSlug,
  parseFindings,
  parseFindingsResult,
  selectConcerns,
} from './retro-parse';
import type { RetroFinding } from './retro-types';

const finding = (over: Partial<RetroFinding> = {}): RetroFinding => ({
  category: 'repair_loop',
  severity: 'high',
  systemic: true,
  slug: 'verify-repair-thrash',
  recommendation: '修復前に関連テストを実行する教育を行う。',
  evidence: 'verify_repair が3回発生',
  ...over,
});

const payload = (findings: unknown) => JSON.stringify({ findings });

describe('normalizeSlug', () => {
  test('小文字化・非英数のハイフン置換・連続圧縮・trim', () => {
    expect(normalizeSlug('Verify  Repair__Thrash!')).toBe('verify-repair-thrash');
  });

  test('40字に切り詰め、末尾ハイフンを再trimする', () => {
    const raw = `${'a'.repeat(39)}-bcd`;
    expect(normalizeSlug(raw)).toBe('a'.repeat(39));
  });

  test('3字未満・非文字列・日本語のみはnull', () => {
    expect(normalizeSlug('ab')).toBeNull();
    expect(normalizeSlug(123)).toBeNull();
    expect(normalizeSlug('日本語のみ')).toBeNull();
  });
});

describe('parseFindingsResult / parseFindings', () => {
  test('正常JSONは検証済みfindingsを返す', () => {
    const raw = payload([finding()]);
    const result = parseFindingsResult(raw);
    expect(result.parseFailed).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].category).toBe('repair_loop');
  });

  test('前置きや余分なテキストがあってもJSON部分を抽出する', () => {
    const raw = `結果は以下です。\n\`\`\`json\n${payload([finding()])}\n\`\`\``;
    expect(parseFindings(raw)).toHaveLength(1);
  });

  test('壊れJSONはparseFailed=trueで空(fail-open)', () => {
    const result = parseFindingsResult('{"findings": [broken');
    expect(result.parseFailed).toBe(true);
    expect(result.findings).toEqual([]);
  });

  test('JSONが存在しないテキストはparseFailed=true', () => {
    expect(parseFindingsResult('評価できませんでした').parseFailed).toBe(true);
  });

  test('findingsが配列でなければparseFailed=true', () => {
    expect(
      parseFindingsResult(payload('not-array').replace('"not-array"', '"x"')).parseFailed,
    ).toBe(true);
    expect(parseFindingsResult('{"findings": {"a": 1}}').parseFailed).toBe(true);
  });

  test('findingsが空配列は正常(パース失敗ではない)', () => {
    const result = parseFindingsResult(payload([]));
    expect(result.parseFailed).toBe(false);
    expect(result.findings).toEqual([]);
  });

  test('enum外categoryのfindingは破棄、他は生きる', () => {
    const raw = payload([
      finding({ category: 'unknown_cat' as RetroFinding['category'] }),
      finding(),
    ]);
    expect(parseFindings(raw)).toHaveLength(1);
  });

  test('severity不正・systemic非boolean・slug不正・recommendation空は破棄', () => {
    const raw = payload([
      finding({ severity: 'critical' as RetroFinding['severity'] }),
      finding({ systemic: 'yes' as unknown as boolean }),
      finding({ slug: 'ん?' }),
      finding({ recommendation: '   ' }),
    ]);
    expect(parseFindings(raw)).toEqual([]);
  });

  test('evidence非文字列は空文字に落とすが破棄しない', () => {
    const raw = payload([finding({ evidence: 42 as unknown as string })]);
    const [f] = parseFindings(raw);
    expect(f.evidence).toBe('');
  });

  test('recommendation/evidenceは上限で切り詰める', () => {
    const raw = payload([finding({ recommendation: 'r'.repeat(600), evidence: 'e'.repeat(1500) })]);
    const [f] = parseFindings(raw);
    expect(f.recommendation).toHaveLength(500);
    expect(f.evidence).toHaveLength(1000);
  });
});

describe('selectConcerns', () => {
  test('systemic=falseと閾値未満(medium/low)は除外する', () => {
    const findings = [
      finding({ systemic: false, severity: 'urgent' }),
      finding({ severity: 'medium' }),
      finding({ severity: 'low' }),
      finding({ severity: 'high', slug: 'kept' }),
    ];
    const selected = selectConcerns(findings);
    expect(selected).toHaveLength(1);
    expect(selected[0].slug).toBe('kept');
  });

  test('severity重み降順・同重みは入力順・最大2件', () => {
    const findings = [
      finding({ severity: 'high', slug: 'high-first' }),
      finding({ severity: 'urgent', slug: 'urgent-one' }),
      finding({ severity: 'high', slug: 'high-second' }),
    ];
    const selected = selectConcerns(findings);
    expect(selected.map((f) => f.slug)).toEqual(['urgent-one', 'high-first']);
    expect(selected).toHaveLength(MAX_RETRO_CONCERNS);
  });
});

describe('buildDedupKey', () => {
  test('retro:<category> 形式でtaskIdを含まない', () => {
    const key = buildDedupKey('critic_loop');
    expect(key).toBe('retro:critic_loop');
    expect(key).not.toMatch(/\d{2,}/);
  });

  test('全カテゴリでprefixが安定している', () => {
    for (const cat of RETRO_CATEGORIES) {
      expect(buildDedupKey(cat)).toBe(`retro:${cat}`);
    }
  });

  test('カテゴリが同じなら所見の文言が違っても1件に集約される', () => {
    // 実測 2026-08-27: slug はモデルが毎回書き直すため、「修復ループが収束しない」
    // という同一の所見が9通りの言い回しで9件の懸念になり、各々が別タスクに昇格した。
    // カテゴリがシグネチャであり、同時に開くのはカテゴリごと1件でよい。
    expect(buildDedupKey('repair_loop')).toBe(buildDedupKey('repair_loop'));
  });
});
