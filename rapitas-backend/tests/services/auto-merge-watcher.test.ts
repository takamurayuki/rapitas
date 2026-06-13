/**
 * auto-merge-watcher テスト
 *
 * CIゲート判定 evaluateAutoMergeChecks の純粋ロジック:
 * gateチェックが全pass→'pass'、いずれかfail/cancel→'fail'、pending有→'pending'、
 * gateチェックが未報告→'unknown'。advisoryチェックは無視されること。
 */
import { describe, test, expect } from 'bun:test';
import { evaluateAutoMergeChecks, type PrCheck } from '../../services/workflow/auto-merge-watcher';

const BLOCKING = new Set(['Test Backend', 'Lint Code', 'Check Frontend']);

function checks(...pairs: Array<[string, string]>): PrCheck[] {
  return pairs.map(([name, bucket]) => ({ name, bucket }));
}

describe('evaluateAutoMergeChecks', () => {
  test('gateチェックが全pass → pass（advisoryのfailは無視）', () => {
    const c = checks(
      ['Test Backend', 'pass'],
      ['Lint Code', 'pass'],
      ['Check Frontend', 'pass'],
      ['Frontend Bundle Size', 'fail'], // advisory — ignored
      ['CodeQL', 'pending'], // advisory — ignored
    );
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('pass');
  });

  test('gateチェックにfailがあれば fail', () => {
    const c = checks(['Test Backend', 'pass'], ['Lint Code', 'fail'], ['Check Frontend', 'pass']);
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('fail');
  });

  test('cancel も fail 扱い', () => {
    const c = checks(['Test Backend', 'cancel'], ['Lint Code', 'pass']);
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('fail');
  });

  test('gateチェックにpendingがあれば pending（failが無い限り）', () => {
    const c = checks(
      ['Test Backend', 'pass'],
      ['Lint Code', 'pending'],
      ['Check Frontend', 'pass'],
    );
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('pending');
  });

  test('skipping は pass 扱い', () => {
    const c = checks(
      ['Test Backend', 'skipping'],
      ['Lint Code', 'pass'],
      ['Check Frontend', 'pass'],
    );
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('pass');
  });

  test('gateチェックが1つも報告されていなければ unknown（早すぎる誤マージを防ぐ）', () => {
    const c = checks(['Frontend Bundle Size', 'pass'], ['CodeQL', 'pass']);
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('unknown');
    expect(evaluateAutoMergeChecks([], BLOCKING)).toBe('unknown');
  });
});
