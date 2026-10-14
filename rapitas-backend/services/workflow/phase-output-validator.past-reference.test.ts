import { describe, expect, test } from 'bun:test';
import { validateVerify } from './phase-output-validator';

const base = (extra: string) => `# 検証結果

## 検証結果サマリ
✅ 検証成功。全テスト通過。

${extra}

## 変更ファイル
| ファイル | 種別 | 変更内容 |
| --- | --- | --- |
| a.ts | 変更 | x |

## テスト結果
全テスト通過 (3 passed)

## チェックリスト
- ✅ 実装

## 未解決の懸念
なし
`;

describe('validateVerify past-reference prose', () => {
  test('past ❌ resolved this time is not a self-contradiction', () => {
    const r = validateVerify(base('前回 ❌ と ⚠️ だった3項目は今回すべて完了'));
    expect(r.ok).toBe(true);
  });
  test('current ❌ line is still detected', () => {
    expect(validateVerify(base('❌ 3件が未達')).ok).toBe(false);
  });
  test('past word does not launder a current failure', () => {
    expect(validateVerify(base('前回 ❌、今回も失敗')).ok).toBe(false);
  });
});
