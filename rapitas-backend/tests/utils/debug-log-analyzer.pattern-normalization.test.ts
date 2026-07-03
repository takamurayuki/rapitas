/**
 * Debug Log Analyzer Pattern Normalization Tests
 *
 * Tests for the private extractPattern() placeholder substitution
 * (exercised indirectly via analyze()'s patterns.errors / .frequentMessages).
 */
import { describe, test, expect } from 'bun:test';
import { DebugLogAnalyzer } from '../../utils/debug-log-analyzer';

describe('DebugLogAnalyzer pattern normalization', () => {
  const analyzer = new DebugLogAnalyzer();

  test('IPアドレスを{IP}に正規化すること', () => {
    // Regression test: extractPattern used to run the {NUMBER} replace
    // before the {IP} replace, so each octet was consumed as a standalone
    // number and the IP pattern could never match (fixed in analyzer.ts).
    const content = [
      '{"level":"error","message":"Connection from 192.168.1.100 failed"}',
      '{"level":"error","message":"Connection from 10.0.0.1 failed"}',
    ].join('\n');

    const result = analyzer.analyze(content);
    const patternStrings = result.patterns.errors.map((p) => p.pattern);
    expect(patternStrings).toContain('Connection from {IP} failed');
    expect(patternStrings.some((p) => p.includes('{NUMBER}'))).toBe(false);
  });

  test('数値・16進数・メール・パスをプレースホルダに正規化すること', () => {
    const content = [
      '{"level":"info","message":"Retrying after 42 seconds"}',
      '{"level":"info","message":"Session deadbeef1234 expired"}',
      '{"level":"info","message":"Notify user@example.com now"}',
      '{"level":"info","message":"Serving /api/v1/users request"}',
    ].join('\n');

    const result = analyzer.analyze(content);
    const patternStrings = result.patterns.frequentMessages.map((p) => p.pattern);
    expect(patternStrings).toContain('Retrying after {NUMBER} seconds');
    expect(patternStrings).toContain('Session {HEX} expired');
    expect(patternStrings).toContain('Notify {EMAIL} now');
    // PATH replaces each "/segment" independently, so a multi-segment
    // path yields one {PATH} placeholder per segment, not a single one.
    expect(patternStrings).toContain('Serving {PATH}{PATH}{PATH} request');
  });
});
