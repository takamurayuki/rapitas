/**
 * complexity-analyzer/analyzers テスト
 *
 * Pure scoring functions — no DB/mocking needed. Covers keyword word-boundary
 * matching, each analyzer's boundary bands, and the three aggregation helpers
 * (getRecommendedMode / calculateEstimatedExecutionTime / calculateConfidence).
 */
import { describe, test, expect } from 'bun:test';
import {
  analyzeKeywords,
  analyzeEstimatedTime,
  analyzePriority,
  analyzeLabels,
  analyzeScope,
  getRecommendedMode,
  calculateEstimatedExecutionTime,
  calculateConfidence,
} from './analyzers';
import type { TaskComplexityInput } from './types';

function input(overrides: Partial<TaskComplexityInput> = {}): TaskComplexityInput {
  return { title: '', description: '', ...overrides };
}

describe('analyzeKeywords', () => {
  test('ASCII keyword matches on word boundary only (no substring false positive)', () => {
    // "ui" is a lightweight keyword; "build" contains it as a substring but must not match.
    const r = analyzeKeywords(input({ title: 'build the pipeline' }));
    expect(r.reasons.some((s) => s.includes('"ui"'))).toBe(false);
  });

  test('ASCII keyword matches as a standalone word', () => {
    const r = analyzeKeywords(input({ title: 'fix the UI' }));
    expect(r.reasons.some((s) => s.includes('Lightweight keyword detected: "UI"'))).toBe(true);
  });

  test('CJK keyword matches via substring containment (no word boundaries in CJK)', () => {
    const r = analyzeKeywords(input({ title: 'ちいさなバグ修正', description: '' }));
    expect(r.reasons.some((s) => s.includes('バグ'))).toBe(true);
  });

  test('balanced (no keywords) → base score 50, balanced reason', () => {
    const r = analyzeKeywords(input({ title: '何かのタスク' }));
    expect(r.score).toBe(50);
    expect(r.reasons).toContain('キーワード分析: バランス型');
  });

  test('more heavyweight than lightweight → score above 50', () => {
    const r = analyzeKeywords(input({ title: '新機能の実装とアーキテクチャ再設計' }));
    expect(r.score).toBeGreaterThan(50);
    expect(r.reasons.some((s) => s.startsWith('Heavyweight tendency'))).toBe(true);
  });

  test('more lightweight than heavyweight → score below 50', () => {
    const r = analyzeKeywords(input({ title: 'タイポ修正とコメント追加' }));
    expect(r.score).toBeLessThan(50);
    expect(r.reasons.some((s) => s.startsWith('Lightweight tendency'))).toBe(true);
  });

  test('score is clamped to [0, 100] under a keyword pile-up', () => {
    // Many heavyweight keywords in one string — balance*15 would exceed 100 unclamped.
    const heavy = [
      '新機能',
      'アーキテクチャ',
      'リファクタリング',
      'データベース',
      'マイグレーション',
      'セキュリティ',
      '統合',
      '大規模',
    ].join(' ');
    const r = analyzeKeywords(input({ title: heavy }));
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThan(0);
  });

  test('description contributes to the matched text along with title', () => {
    const r = analyzeKeywords(input({ title: 'タスク', description: 'バグ修正' }));
    expect(r.reasons.some((s) => s.includes('バグ'))).toBe(true);
  });
});

describe('analyzeEstimatedTime', () => {
  test('unset → default score 50', () => {
    expect(analyzeEstimatedTime(input()).score).toBe(50);
  });

  test('boundary: exactly 1 hour → lightweight band (20)', () => {
    expect(analyzeEstimatedTime(input({ estimatedHours: 1 })).score).toBe(20);
  });

  test('boundary: just above 1 hour → next band (35)', () => {
    expect(analyzeEstimatedTime(input({ estimatedHours: 1.5 })).score).toBe(35);
  });

  test('boundary: exactly 2 hours → 35, exactly 2.01 → 60', () => {
    expect(analyzeEstimatedTime(input({ estimatedHours: 2 })).score).toBe(35);
    expect(analyzeEstimatedTime(input({ estimatedHours: 2.01 })).score).toBe(60);
  });

  test('boundary: exactly 4 hours → 60, just above → 80', () => {
    expect(analyzeEstimatedTime(input({ estimatedHours: 4 })).score).toBe(60);
    expect(analyzeEstimatedTime(input({ estimatedHours: 4.5 })).score).toBe(80);
  });

  test('boundary: exactly 8 hours → 80, just above → 95 (ultra-heavyweight)', () => {
    expect(analyzeEstimatedTime(input({ estimatedHours: 8 })).score).toBe(80);
    expect(analyzeEstimatedTime(input({ estimatedHours: 8.5 })).score).toBe(95);
  });
});

describe('analyzePriority', () => {
  test('unset → default score 50', () => {
    expect(analyzePriority(input()).score).toBe(50);
  });

  test.each([
    ['low', 30],
    ['medium', 50],
    ['high', 70],
    ['urgent', 40],
  ])('priority=%s → score %d', (priority, expected) => {
    expect(analyzePriority(input({ priority })).score).toBe(expected);
  });

  test('unknown priority string → default score 50 with a diagnostic reason', () => {
    const r = analyzePriority(input({ priority: 'critical' }));
    expect(r.score).toBe(50);
    expect(r.reasons[0]).toContain('Unknown priority: critical');
  });
});

describe('analyzeLabels', () => {
  test('no labels → default score 50', () => {
    expect(analyzeLabels(input({ labels: [] })).score).toBe(50);
    expect(analyzeLabels(input()).score).toBe(50);
  });

  test('a lightweight label lowers the score below 50', () => {
    const r = analyzeLabels(input({ labels: ['bug'] }));
    expect(r.score).toBeLessThan(50);
  });

  test('a heavyweight label raises the score above 50', () => {
    const r = analyzeLabels(input({ labels: ['feature'] }));
    expect(r.score).toBeGreaterThan(50);
  });

  test('one lightweight + one heavyweight label cancel out to 50', () => {
    const r = analyzeLabels(input({ labels: ['bug', 'feature'] }));
    expect(r.score).toBe(50);
  });

  test('score is clamped at 100 with many heavyweight labels', () => {
    const r = analyzeLabels(
      input({ labels: ['feature', 'database', 'schema', 'migration', 'security'] }),
    );
    expect(r.score).toBe(100);
  });

  test('label matching is case-insensitive', () => {
    const r = analyzeLabels(input({ labels: ['FEATURE'] }));
    expect(r.score).toBeGreaterThan(50);
  });
});

describe('analyzeScope', () => {
  test('no description and no spec items → default score 50', () => {
    const r = analyzeScope(input({ description: '' }));
    expect(r.score).toBe(50);
    expect(r.reasons[0]).toContain('スコープ情報なし');
  });

  test('description-only: short text (<80 chars) → 30', () => {
    const r = analyzeScope(input({ description: 'short desc' }));
    expect(r.score).toBe(30);
  });

  test('description-only: long text (>=600 chars) → 85', () => {
    const r = analyzeScope(input({ description: 'x'.repeat(650) }));
    expect(r.score).toBe(85);
  });

  test('spec-only: many acceptance criteria (>9) → 92', () => {
    const r = analyzeScope(
      input({ description: '', acceptanceCriteria: Array.from({ length: 10 }, () => 'ac') }),
    );
    expect(r.score).toBe(92);
  });

  test('spec-only: few items (<=2) → 45', () => {
    const r = analyzeScope(input({ description: '', goals: ['g1'] }));
    expect(r.score).toBe(45);
  });

  test('both description and spec present → weighted blend (0.45 desc + 0.55 spec)', () => {
    // desc 90 chars → descScore 50; 3 spec items → specScore 62.
    const r = analyzeScope(
      input({
        description: 'y'.repeat(90),
        goals: ['g1'],
        constraints: ['c1'],
        acceptanceCriteria: ['a1'],
      }),
    );
    expect(r.score).toBe(Math.round(50 * 0.45 + 62 * 0.55));
  });
});

describe('getRecommendedMode', () => {
  test('boundary: 35 → lightweight, 36 → standard', () => {
    expect(getRecommendedMode(35)).toBe('lightweight');
    expect(getRecommendedMode(36)).toBe('standard');
  });

  test('boundary: 70 → standard, 71 → comprehensive', () => {
    expect(getRecommendedMode(70)).toBe('standard');
    expect(getRecommendedMode(71)).toBe('comprehensive');
  });

  test('extremes: 0 → lightweight, 100 → comprehensive', () => {
    expect(getRecommendedMode(0)).toBe('lightweight');
    expect(getRecommendedMode(100)).toBe('comprehensive');
  });
});

describe('calculateEstimatedExecutionTime', () => {
  test.each([
    ['lightweight', 20],
    ['standard', 90],
    ['comprehensive', 210],
  ])('%s → %d minutes', (mode, expected) => {
    expect(
      calculateEstimatedExecutionTime(mode as 'lightweight' | 'standard' | 'comprehensive'),
    ).toBe(expected);
  });
});

describe('calculateConfidence', () => {
  test('all factors agreeing at the neutral midpoint + no estimated time → base 0.5', () => {
    const c = calculateConfidence(50, 50, 50, 50, 50, false);
    expect(c).toBeCloseTo(0.5 + 1 * 0.2, 5); // zero variance → consistency=1 → +0.2
  });

  test('estimated time present adds a flat +0.2', () => {
    const withTime = calculateConfidence(50, 50, 50, 50, 50, true);
    const withoutTime = calculateConfidence(50, 50, 50, 50, 50, false);
    expect(withTime - withoutTime).toBeCloseTo(0.2, 5);
  });

  test('strong keyword deviation from 50 increases confidence (capped at +0.3)', () => {
    const deviated = calculateConfidence(100, 50, 50, 50, 50, false);
    const neutral = calculateConfidence(50, 50, 50, 50, 50, false);
    expect(deviated).toBeGreaterThan(neutral);
  });

  test('result is clamped to a maximum of 1.0', () => {
    const c = calculateConfidence(100, 100, 100, 100, 100, true);
    expect(c).toBeLessThanOrEqual(1.0);
  });

  test('high variance across factors lowers the consistency bonus', () => {
    // Hold keywordScore at 50 (zero deviation bonus) in both cases so only the
    // cross-factor variance term differs between them.
    const highVariance = calculateConfidence(50, 0, 100, 0, 100, false);
    const noVariance = calculateConfidence(50, 50, 50, 50, 50, false);
    expect(highVariance).toBeLessThan(noVariance);
  });
});
