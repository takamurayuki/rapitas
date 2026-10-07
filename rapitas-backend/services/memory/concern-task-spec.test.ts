/**
 * concern-task-spec.test
 *
 * The constraint list is the point of this module, so it is asserted directly:
 * task 685 satisfied its only criterion (「ERROR ログが解消」) by suppressing the
 * log line rather than diagnosing, and the spec exists to make that path
 * unavailable while still allowing a REASONED suppression.
 */
import { describe, test, expect } from 'bun:test';
import {
  concernNeedsPlanForProtectedPath,
  needsPlanForProtectedPath,
  specForConcernSource,
} from './concern-task-spec';

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

describe('concernNeedsPlanForProtectedPath', () => {
  // 2026-09-28, concern 11668 / task 1112: detail carried only the bare filename
  // while `location` held the full path. convertConcernToTask builds the task
  // body from BOTH, but the mode decision only saw detail — so the task was
  // filed lightweight even though its fix lands under the tamper tripwire.
  test('detail はファイル名だけ、location にフルパスがある場合も検知する', () => {
    const concern = {
      detail: 'phase-output-validator.ts:389の正規表現が過去状態の言及に誤反応する',
      location: 'rapitas-backend/services/workflow/phase-output-validator.ts:389',
    };
    expect(needsPlanForProtectedPath(concern.detail)).toBe(false); // 旧判定は見落とす
    expect(concernNeedsPlanForProtectedPath(concern)).toBe(true);
  });

  test('detail 側だけにフルパスがある従来のケースも引き続き検知する', () => {
    expect(
      concernNeedsPlanForProtectedPath({
        detail:
          'at spawnNewEntry (rapitas-backend/services/agents/verification/runtime-smoke/x.ts:1:1)',
        location: null,
      }),
    ).toBe(true);
  });

  test('どちらにも保護パスが無ければ false、欠損入力でも落ちない', () => {
    expect(
      concernNeedsPlanForProtectedPath({
        detail: 'services/system/log-health-check.ts:1',
        location: 'services/system/log-health-check.ts:1',
      }),
    ).toBe(false);
    expect(concernNeedsPlanForProtectedPath({})).toBe(false);
    expect(concernNeedsPlanForProtectedPath(null)).toBe(false);
    expect(concernNeedsPlanForProtectedPath(undefined)).toBe(false);
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

  // 2026-09-27 タスク1110: 抑制ルールは正規化後のメッセージと照合される(数字列は
  // `#` に畳まれる)が、その正規化は別ファイルにあり差分には現れない。差分しか見ない
  // ジャッジは規約どおりの `#` パターンを生ログの数字と比べて不合格にし、費用上限の
  // 1 分前に修復ラウンドを 1 回潰した。規約を基準文に載せてジャッジの入力に含める。
  test('受入基準は抑制ルールの照合規約(数字は # に畳まれる)をジャッジに伝える', () => {
    const criteria = (specForConcernSource('log_health')?.acceptanceCriteria ?? []).join('\n');
    expect(criteria).toContain('正規化後');
    expect(criteria).toContain('#');
  });

  test('他の出所には仕様を与えない', () => {
    expect(specForConcernSource('agent')).toBeNull();
    expect(specForConcernSource('vuln_scan')).toBeNull();
    expect(specForConcernSource(null)).toBeNull();
    expect(specForConcernSource(undefined)).toBeNull();
  });
});

describe('specForConcernSource — guard-incident', () => {
  test('ガード違反由来の懸念にも仕様を与える', () => {
    const spec = specForConcernSource('guard-incident');
    expect(spec).not.toBeNull();
    expect(spec?.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  // The defect this template exists for: task 1116's auto-generated criterion
  // was 「エージェントが同様の primary_mutation タイプの操作を試行しなくなること」.
  // Nothing in a diff can show that, so verify marked it 未検証（行動効果）and a
  // requirement_evidence_replan round was spent on it — and the fix it shipped
  // (a prompt paragraph) then measurably failed: 5 incidents before, 1 after
  // with the fix live. Every criterion must be decidable from the diff.
  test('将来の行動を問う検証不能な基準を含まない', () => {
    const criteria = (specForConcernSource('guard-incident')?.acceptanceCriteria ?? []).join('\n');
    expect(criteria).not.toMatch(/しなくなる|再発しない|発生しなくなる|減ること/);
  });

  test('基準は差分または workflow 成果物で判定できる形になっている', () => {
    const criteria = specForConcernSource('guard-incident')?.acceptanceCriteria ?? [];
    for (const c of criteria) {
      expect(c).toMatch(/差分|research\.md|verify\.md|plan\.md/);
    }
  });

  // The hook is the detector, not the defect — relaxing it is how task 1086
  // "resolved" its own denial.
  test('検知器を緩める変更を禁じる', () => {
    const constraints = (specForConcernSource('guard-incident')?.constraints ?? []).join('\n');
    expect(constraints).toContain('primary-guard-hook');
    expect(constraints).toMatch(/緩め|緩和/);
  });

  test('無関係なソースには仕様を与えない', () => {
    expect(specForConcernSource('other')).toBeNull();
  });
});
