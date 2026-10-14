/**
 * validateVerify × plan 縮小宣言 テスト
 *
 * plan が非対象と宣言した受入基準のみ未達なら不合格にせず、未宣言の基準・plan 不在・
 * 宣言が解釈不能な場合は従来どおり不合格になることを検証する。
 */
import { describe, expect, test } from 'bun:test';
import { validateVerify } from './phase-output-validator';

const verify = (rows: string[]) => `# 検証レポート

## 検証結果サマリ

⚠️ 一部失敗

| 項目 | 値 |
| --- | --- |
| 全体判定 | ⚠️ 一部失敗 |

## テスト結果

12 pass, 0 fail (exit 0)

## チェックリスト

${rows.join('\n')}
`;

const plan = (ids: number[], reason = '懸念#9903 で追跡中') =>
  '## 計画\n\n```json:out-of-scope-criteria\n' +
  JSON.stringify({ version: 1, criteria: ids.map((id) => ({ id, reason })) }) +
  '\n```\n';

describe('validateVerify with plan scope declaration', () => {
  test('declared criterion only -> ok', () => {
    const r = validateVerify(verify(['- ✅ 受入条件1: 達成', '- ⚠️ 受入条件3: 未達']), plan([3]));
    expect(r.ok).toBe(true);
  });
  test('undeclared criterion -> fails as before (severity 90)', () => {
    const r = validateVerify(verify(['- ⚠️ 受入条件4: 未達']), plan([3]));
    expect(r.ok).toBe(false);
    expect(r.severity).toBe(90);
  });
  test('plan undefined / empty -> legacy verdict', () => {
    const body = verify(['- ⚠️ 受入条件3: 未達']);
    expect(validateVerify(body).ok).toBe(false);
    expect(validateVerify(body, undefined).ok).toBe(false);
    expect(validateVerify(body, '').ok).toBe(false);
  });
  test('mixed declared and undeclared -> fails and quotes the undeclared row', () => {
    const r = validateVerify(verify(['- ⚠️ 受入条件3: 未達', '- ❌ 受入条件4: 未達']), plan([3]));
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('受入条件4');
  });
  test('基準1 declaration does not excuse 基準10', () => {
    const r = validateVerify(verify(['- ⚠️ 基準10: 未達']), plan([1]));
    expect(r.ok).toBe(false);
  });
  test('malformed / reasonless declaration -> legacy verdict', () => {
    const body = verify(['- ⚠️ 受入条件3: 未達']);
    expect(validateVerify(body, plan([3], '')).ok).toBe(false);
    expect(validateVerify(body, '```json:out-of-scope-criteria\n{bad\n```').ok).toBe(false);
  });
  test('partial verdict with zero non-passing rows is not rescued', () => {
    const r = validateVerify(verify(['- ✅ 受入条件1: 達成']), plan([3]));
    expect(r.ok).toBe(false);
  });
});
