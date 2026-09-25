/**
 * concern-task-spec.test
 *
 * The constraint list is the point of this module, so it is asserted directly:
 * task 685 satisfied its only criterion (「ERROR ログが解消」) by suppressing the
 * log line rather than diagnosing, and the spec exists to make that path
 * unavailable while still allowing a REASONED suppression.
 */
import { describe, test, expect } from 'bun:test';
import { needsPlanForProtectedPath, specForConcernSource } from './concern-task-spec';

describe('needsPlanForProtectedPath', () => {
  test('task 1044: 検証ゲート配下のスタックを持つ懸念は plan が必要', () => {
    const detail = [
      'ロガー: runtime-smoke:registry',
      'Error: Spawned process identity cannot be confirmed',
      '    at spawnNewEntry (C:\\Projects\\rapitas\\rapitas-backend\\services\\agents\\verification\\runtime-smoke\\runtime-server-registry-lifecycle.ts:182:15)',
    ].join('\n');
    expect(needsPlanForProtectedPath(detail)).toBe(true);
    expect(needsPlanForProtectedPath('at x (/repo/.github/workflows/ci.yml:1:1)')).toBe(true);
    expect(
      needsPlanForProtectedPath(
        'at y (rapitas-backend/services/workflow/verify-self-repair.ts:9:9)',
      ),
    ).toBe(true);
    // 2026-09-25, task 1086: a lightweight guard-incident task relaxed the
    // guard hook's regex without a plan.
    expect(
      needsPlanForProtectedPath('実行前フックが拒否した。検知器: scripts/primary-guard-hook.cjs'),
    ).toBe(true);
  });

  test('通常のサービス配下や本文無しは対象外', () => {
    expect(
      needsPlanForProtectedPath(
        'at z (C:\\Projects\\rapitas\\rapitas-backend\\services\\system\\event-loop-lag-watchdog.ts:121:5)',
      ),
    ).toBe(false);
    expect(needsPlanForProtectedPath('services/workflow/phase-critic/critic-lessons.ts')).toBe(
      false,
    );
    expect(needsPlanForProtectedPath('')).toBe(false);
    expect(needsPlanForProtectedPath(null)).toBe(false);
    expect(needsPlanForProtectedPath(undefined)).toBe(false);
  });
});

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
