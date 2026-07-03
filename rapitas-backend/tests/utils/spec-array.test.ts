/**
 * spec-array テスト
 * JSON配列文字列カラム（goals/constraints/acceptanceCriteria）のパースのテスト
 */
import { describe, test, expect } from 'bun:test';
import { parseSpecArray } from '../../utils/common/spec-array';

describe('parseSpecArray', () => {
  test('nullの場合は空配列を返すこと', () => {
    expect(parseSpecArray(null)).toEqual([]);
  });

  test('undefinedの場合は空配列を返すこと', () => {
    expect(parseSpecArray(undefined)).toEqual([]);
  });

  test('空文字列の場合は空配列を返すこと', () => {
    expect(parseSpecArray('')).toEqual([]);
  });

  test('不正なJSON文字列の場合は例外を投げず空配列を返すこと', () => {
    expect(parseSpecArray('{not valid json')).toEqual([]);
  });

  test('文字列配列のJSONを正しくパースすること', () => {
    expect(parseSpecArray('["goal1", "goal2"]')).toEqual(['goal1', 'goal2']);
  });

  test('空配列のJSONは空配列を返すこと', () => {
    expect(parseSpecArray('[]')).toEqual([]);
  });

  test('文字列以外の要素を除外すること', () => {
    expect(parseSpecArray('["a", 1, null, true, "b", {}]')).toEqual(['a', 'b']);
  });

  test.each([
    ['オブジェクト', '{"a": 1}'],
    ['数値', '42'],
    ['文字列', '"just a string"'],
  ])('配列以外のJSON（%s）は空配列を返すこと', (_label, value) => {
    expect(parseSpecArray(value)).toEqual([]);
  });

  test('日本語を含む文字列配列を正しくパースすること', () => {
    expect(parseSpecArray('["目標1", "制約2"]')).toEqual(['目標1', '制約2']);
  });
});
