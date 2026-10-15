/**
 * risk-assessor.test.ts
 *
 * Unit tests for risk scoring: threshold boundary values, axis caps, and
 * end-to-end level resolution from representative texts.
 */
import { describe, it, expect } from 'bun:test';
import { assessRisk, resolveRiskLevel } from './risk-assessor';

describe('resolveRiskLevel — threshold boundaries', () => {
  it.each([
    [39, 'low'],
    [40, 'medium'],
    [69, 'medium'],
    [70, 'high'],
    [89, 'high'],
    [90, 'critical'],
  ] as const)('score %d resolves to %s', (score, expected) => {
    expect(resolveRiskLevel(score)).toBe(expected);
  });
});

describe('assessRisk', () => {
  it('scores a short PII-free text as low', () => {
    const result = assessRisk('Database connection refused at startup');
    expect(result.level).toBe('low');
    expect(result.piiHitCount).toBe(0);
    expect(result.score).toBeLessThan(40);
  });

  it('scores one PII hit in a short text as low (20 points)', () => {
    const result = assessRisk('user test@example.com not found');
    expect(result.piiHitCount).toBe(1);
    expect(result.score).toBe(20);
    expect(result.level).toBe('low');
  });

  it('scores two PII hits as medium (40 points)', () => {
    const result = assessRisk('from a@example.com to b@example.org');
    expect(result.piiHitCount).toBe(2);
    expect(result.score).toBe(40);
    expect(result.level).toBe('medium');
  });

  it('caps the PII axis at 60 points regardless of hit count', () => {
    const emails = Array.from({ length: 10 }, (_, i) => `user${i}@example.com`).join(' ');
    const result = assessRisk(emails);
    expect(result.piiHitCount).toBe(10);
    // 10 hits * 20 = 200 capped to 60, plus a small token contribution.
    expect(result.score).toBeLessThanOrEqual(60 + 40);
    expect(result.score).toBeGreaterThanOrEqual(60);
  });

  it('caps the token axis at 40 points for huge PII-free text', () => {
    const result = assessRisk('word '.repeat(2000));
    expect(result.piiHitCount).toBe(0);
    expect(result.score).toBe(40);
    expect(result.level).toBe('medium');
  });

  it('scores 3+ PII hits plus a large text as critical', () => {
    const big = 'a@example.com b@example.org c@example.net ' + 'padding words here '.repeat(200);
    const result = assessRisk(big);
    expect(result.piiHitCount).toBeGreaterThanOrEqual(3);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.level).toBe('critical');
  });

  it('reports the token count of the assessed text', () => {
    const result = assessRisk('abcd'.repeat(50)); // 200 ASCII chars ≈ 50 tokens
    expect(result.tokenCount).toBe(50);
  });
});
