/**
 * plan-out-of-scope-criteria テスト
 *
 * plan.md の `json:out-of-scope-criteria` フェンスの解釈と、verify.md の未達行との
 * 照合（番号の整数一致のみ・未達 0 件では救済しない）を検証する。
 */
import { describe, expect, test } from 'bun:test';
import {
  parseOutOfScopeCriteria,
  isDeclaredScopeReductionOnly,
} from './plan-out-of-scope-criteria';

const fence = (body: string) => '## 計画\n\n```json:out-of-scope-criteria\n' + body + '\n```\n';
const decl = (ids: number[]) =>
  fence(
    JSON.stringify({ version: 1, criteria: ids.map((id) => ({ id, reason: '懸念#9903 で追跡' })) }),
  );

describe('parseOutOfScopeCriteria', () => {
  test('returns declared ids, deduplicated', () => {
    expect(parseOutOfScopeCriteria(decl([3, 3, 5]))).toEqual([3, 5]);
  });
  test('returns [] for undefined / empty / no fence', () => {
    expect(parseOutOfScopeCriteria(undefined)).toEqual([]);
    expect(parseOutOfScopeCriteria('')).toEqual([]);
    expect(parseOutOfScopeCriteria('## 計画\n基準3は対象外')).toEqual([]);
  });
  test('returns [] for malformed JSON', () => {
    expect(parseOutOfScopeCriteria(fence('{not json'))).toEqual([]);
  });
  test('returns [] for wrong version', () => {
    expect(
      parseOutOfScopeCriteria(fence('{"version":2,"criteria":[{"id":3,"reason":"x"}]}')),
    ).toEqual([]);
  });
  test('returns [] when reason is empty', () => {
    expect(
      parseOutOfScopeCriteria(fence('{"version":1,"criteria":[{"id":3,"reason":"  "}]}')),
    ).toEqual([]);
  });
  test('returns [] for non-integer id', () => {
    expect(
      parseOutOfScopeCriteria(fence('{"version":1,"criteria":[{"id":"3","reason":"x"}]}')),
    ).toEqual([]);
    expect(
      parseOutOfScopeCriteria(fence('{"version":1,"criteria":[{"id":1.5,"reason":"x"}]}')),
    ).toEqual([]);
  });
  test('returns [] for empty criteria array', () => {
    expect(parseOutOfScopeCriteria(fence('{"version":1,"criteria":[]}'))).toEqual([]);
  });
  test('returns [] when two fences exist (ambiguous)', () => {
    expect(parseOutOfScopeCriteria(decl([3]) + '\n' + decl([4]))).toEqual([]);
  });
});

describe('isDeclaredScopeReductionOnly', () => {
  test('true when every non-passing row is a declared criterion', () => {
    const v = '| 受入条件3 | ⚠️ 未達 |\n| 受入条件1 | ✅ |';
    expect(isDeclaredScopeReductionOnly(v, [3])).toBe(true);
  });
  test('false when an undeclared row remains', () => {
    const v = '| 受入条件3 | ⚠️ 未達 |\n| 受入条件4 | ❌ 未達 |';
    expect(isDeclaredScopeReductionOnly(v, [3])).toBe(false);
  });
  test('false when no non-passing rows exist', () => {
    expect(isDeclaredScopeReductionOnly('全体判定: ⚠️ 一部失敗', [3])).toBe(false);
  });
  test('false when no ids declared', () => {
    expect(isDeclaredScopeReductionOnly('| 受入条件3 | ⚠️ |', [])).toBe(false);
  });
  test('基準1 does not match 基準10', () => {
    expect(isDeclaredScopeReductionOnly('- ⚠️ 基準10: 未達', [1])).toBe(false);
    expect(isDeclaredScopeReductionOnly('- ⚠️ 基準1: 未達', [1])).toBe(true);
  });
  test('recognises bold, emoji-prefixed, numeric-cell and numbered-list rows', () => {
    expect(isDeclaredScopeReductionOnly('- **受入条件3**: ⚠️ 未達', [3])).toBe(true);
    expect(isDeclaredScopeReductionOnly('| ⚠️ 受入条件3 | 未達 |', [3])).toBe(true);
    expect(isDeclaredScopeReductionOnly('| 3 | 受入内容 | ⚠️ 未達 |', [3])).toBe(true);
    expect(isDeclaredScopeReductionOnly('3. ⚠️ 未達', [3])).toBe(true);
    expect(isDeclaredScopeReductionOnly('| 30 | 受入内容 | ⚠️ 未達 |', [3])).toBe(false);
  });
  test('row without a leading criterion number is not declared', () => {
    expect(isDeclaredScopeReductionOnly('- ⚠️ 型チェックが未実施 (基準3 関連)', [3])).toBe(false);
  });
});
