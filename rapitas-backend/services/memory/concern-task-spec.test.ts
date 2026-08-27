/**
 * concern-task-spec.test
 *
 * The constraint list is the point of this module, so it is asserted directly:
 * task 685 satisfied its only criterion (「ERROR ログが解消」) by suppressing the
 * log line rather than diagnosing, and the spec exists to make that path
 * unavailable while still allowing a REASONED suppression.
 */
import { describe, test, expect } from 'bun:test';
import { specForConcernSource } from './concern-task-spec';

describe('specForConcernSource', () => {
  test('ログ由来の懸念には仕様を与える', () => {
    const spec = specForConcernSource('log_health');
    expect(spec).not.toBeNull();
    expect(spec?.goals.length).toBeGreaterThan(0);
    expect(spec?.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  test('ログ出力を消して解決したことにするのを禁じる', () => {
    const spec = specForConcernSource('log_health');
    const constraints = (spec?.constraints ?? []).join('\n');
    expect(constraints).toContain('レベル降格');
    expect(constraints).toContain('解消');
  });

  test('理由付きであれば抑制も正当な結末として認める', () => {
    const spec = specForConcernSource('log_health');
    const criteria = (spec?.acceptanceCriteria ?? []).join('\n');
    expect(criteria).toContain('抑制ルール');
    expect(criteria).toContain('理由');
  });

  test('受入基準は判定の根拠を要求する', () => {
    const criteria = (specForConcernSource('log_health')?.acceptanceCriteria ?? []).join('\n');
    expect(criteria).toContain('根拠');
  });

  test('他の出所には仕様を与えない', () => {
    expect(specForConcernSource('agent')).toBeNull();
    expect(specForConcernSource('vuln_scan')).toBeNull();
    expect(specForConcernSource(null)).toBeNull();
    expect(specForConcernSource(undefined)).toBeNull();
  });
});
