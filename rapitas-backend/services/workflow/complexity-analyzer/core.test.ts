/**
 * complexity-analyzer/core テスト
 *
 * analyzeTaskComplexity's weighted aggregation, analyzeBatchComplexity, and
 * the static getWorkflowModeConfig table. Pure — no mocking needed.
 */
import { describe, test, expect } from 'bun:test';
import { analyzeTaskComplexity, analyzeBatchComplexity, getWorkflowModeConfig } from './core';
import type { TaskComplexityInput } from './types';

describe('analyzeTaskComplexity', () => {
  test('an empty/neutral task aggregates to the midpoint and standard mode', () => {
    const input: TaskComplexityInput = { title: '何かのタスク' };
    const result = analyzeTaskComplexity(input);
    // All five factors default to 50 → weighted average is exactly 50.
    expect(result.complexityScore).toBe(50);
    expect(result.recommendedMode).toBe('standard');
    expect(result.estimatedExecutionTime).toBe(90);
  });

  test('a clearly lightweight task (bug fix, tiny estimate, low priority) scores low', () => {
    const input: TaskComplexityInput = {
      title: 'バグ修正: タイポ',
      description: 'ちいさな修正',
      estimatedHours: 0.5,
      priority: 'low',
      labels: ['bug'],
    };
    const result = analyzeTaskComplexity(input);
    expect(result.recommendedMode).toBe('lightweight');
    expect(result.complexityScore).toBeLessThanOrEqual(35);
  });

  test('a clearly heavyweight task (new feature, big estimate, many spec items) scores high', () => {
    const input: TaskComplexityInput = {
      title: '新機能の実装: アーキテクチャ再設計とデータベースマイグレーション',
      description: 'x'.repeat(700),
      estimatedHours: 12,
      priority: 'high',
      labels: ['feature', 'architecture', 'database'],
      goals: ['g1', 'g2', 'g3'],
      constraints: ['c1', 'c2', 'c3'],
      acceptanceCriteria: ['a1', 'a2', 'a3', 'a4'],
    };
    const result = analyzeTaskComplexity(input);
    expect(result.recommendedMode).toBe('comprehensive');
    expect(result.complexityScore).toBeGreaterThan(70);
    expect(result.estimatedExecutionTime).toBe(210);
  });

  test('analysisBreakdown exposes each rounded factor score and aggregates all reasons', () => {
    const input: TaskComplexityInput = { title: 'fix bug', priority: 'high' };
    const result = analyzeTaskComplexity(input);
    expect(result.analysisBreakdown.priorityScore).toBe(70);
    expect(Array.isArray(result.analysisBreakdown.reasons)).toBe(true);
    expect(result.analysisBreakdown.reasons.length).toBeGreaterThan(0);
  });

  test('confidence reflects whether estimatedHours was supplied', () => {
    const withHours = analyzeTaskComplexity({ title: 'タスク', estimatedHours: 3 });
    const withoutHours = analyzeTaskComplexity({ title: 'タスク' });
    expect(withHours.confidence).toBeGreaterThan(withoutHours.confidence);
  });
});

describe('analyzeBatchComplexity', () => {
  test('maps each input to its own analysis result, preserving order', () => {
    const inputs: TaskComplexityInput[] = [
      { title: 'バグ修正', priority: 'low', estimatedHours: 0.5, labels: ['bug'] },
      { title: '新機能実装', priority: 'high', estimatedHours: 10 },
    ];
    const results = analyzeBatchComplexity(inputs);
    expect(results).toHaveLength(2);
    expect(results[0].recommendedMode).toBe('lightweight');
    expect(results[1].recommendedMode).toBe('comprehensive');
  });

  test('empty input array → empty result array', () => {
    expect(analyzeBatchComplexity([])).toEqual([]);
  });
});

describe('getWorkflowModeConfig', () => {
  test('returns all three modes with non-overlapping, contiguous complexity ranges', () => {
    const config = getWorkflowModeConfig();
    expect(config.lightweight.complexityRange).toEqual([0, 35]);
    expect(config.standard.complexityRange).toEqual([36, 70]);
    expect(config.comprehensive.complexityRange).toEqual([71, 100]);
  });

  test('each mode estimatedTime matches calculateEstimatedExecutionTime for that mode', () => {
    const config = getWorkflowModeConfig();
    expect(config.lightweight.estimatedTime).toBe(20);
    expect(config.standard.estimatedTime).toBe(90);
    expect(config.comprehensive.estimatedTime).toBe(210);
  });
});
