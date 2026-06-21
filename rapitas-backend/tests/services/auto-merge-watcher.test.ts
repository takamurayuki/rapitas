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

  // --- 境界値テスト ---

  test('blocking が空 Set のとき relevant=0 → unknown', () => {
    // blocking に一致する名前が存在しないため relevant.length === 0
    const c = checks(['Test Backend', 'pass'], ['Lint Code', 'fail']);
    expect(evaluateAutoMergeChecks(c, new Set())).toBe('unknown');
  });

  test('同一チェック名が2件（fail+pass）あれば fail が優先される', () => {
    // NOTE: blocking.has() は名前のみで判定するため重複名は両方 relevant に入る。
    //       relevant.some(fail) が true になることを固定する。
    const c = checks(['Test Backend', 'fail'], ['Test Backend', 'pass'], ['Lint Code', 'pass']);
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('fail');
  });

  test('未知 bucket（error / timeout / 空文字）は pass 扱い（将来 GitHub 新 bucket への回帰検知点）', () => {
    // fail / cancel / pending のいずれにも該当しないため pass にフォールスルーする現挙動を固定
    const withError = checks(['Test Backend', 'error'], ['Lint Code', 'pass']);
    expect(evaluateAutoMergeChecks(withError, BLOCKING)).toBe('pass');

    const withTimeout = checks(['Test Backend', 'timeout'], ['Lint Code', 'pass']);
    expect(evaluateAutoMergeChecks(withTimeout, BLOCKING)).toBe('pass');

    const withEmpty = checks(['Test Backend', ''], ['Lint Code', 'pass']);
    expect(evaluateAutoMergeChecks(withEmpty, BLOCKING)).toBe('pass');
  });

  test('fail と pending が同時に存在する場合 fail が pending より優先される', () => {
    // evaluateAutoMergeChecks の評価順: fail/cancel チェック (:115) が pending (:116) より先
    const c = checks(['Test Backend', 'fail'], ['Lint Code', 'pending'], ['Check Frontend', 'pass']);
    expect(evaluateAutoMergeChecks(c, BLOCKING)).toBe('fail');
  });
});
