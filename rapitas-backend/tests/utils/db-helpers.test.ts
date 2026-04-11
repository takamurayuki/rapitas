/**
 * Database Helper Utilities テスト
 * JSON変換、ID解析などの純粋関数のテスト
 */
import { describe, test, expect } from 'bun:test';
import {
  getLabelsArray,
  toJsonString,
  fromJsonString,
  parseId,
} from '../../utils/database/db-helpers';

describe('getLabelsArray', () => {
  test('null/undefinedで空配列を返すこと', () => {
    expect(getLabelsArray(null)).toEqual([]);
    expect(getLabelsArray(undefined)).toEqual([]);
  });

  test('空文字列で空配列を返すこと', () => {
    expect(getLabelsArray('')).toEqual([]);
  });

  test('JSON文字列配列を正しくパースすること', () => {
    expect(getLabelsArray('["bug","feature"]')).toEqual(['bug', 'feature']);
  });

  test('JSON空配列文字列で空配列を返すこと', () => {
    expect(getLabelsArray('[]')).toEqual([]);
  });

  test('無効なJSON文字列で空配列を返すこと', () => {
    expect(getLabelsArray('invalid json')).toEqual([]);
    expect(getLabelsArray('{not array}')).toEqual([]);
  });

  test('オブジェクト配列（PostgreSQLリレーション形式）からnameを抽出すること', () => {
    const labels = [{ name: 'bug' }, { name: 'feature' }];
    expect(getLabelsArray(labels)).toEqual(['bug', 'feature']);
  });

  test('文字列配列をそのまま返すこと', () => {
    expect(getLabelsArray(['bug', 'feature'])).toEqual(['bug', 'feature']);
  });

  test('空配列で空配列を返すこと', () => {
    expect(getLabelsArray([])).toEqual([]);
  });

  test('非文字列要素を除外すること', () => {
    expect(getLabelsArray(['bug', 123, 'feature'])).toEqual(['bug', 'feature']);
  });
});

describe('toJsonString', () => {
  test('nullでnullを返すこと', () => {
    expect(toJsonString(null)).toBeNull();
  });

  test('undefinedでnullを返すこと', () => {
    expect(toJsonString(undefined)).toBeNull();
  });

  test('文字列をそのまま返すこと', () => {
    expect(toJsonString('["bug"]')).toBe('["bug"]');
  });

  test('オブジェクトをJSON文字列に変換すること', () => {
    expect(toJsonString(['bug', 'feature'])).toBe('["bug","feature"]');
  });

  test('オブジェクトをJSON文字列に変換すること', () => {
    expect(toJsonString({ key: 'value' })).toBe('{"key":"value"}');
  });
});

describe('fromJsonString', () => {
  test('nullでnullを返すこと', () => {
    expect(fromJsonString(null)).toBeNull();
  });

  test('undefinedでnullを返すこと', () => {
    expect(fromJsonString(undefined)).toBeNull();
  });

  test('有効なJSON文字列をパースすること', () => {
    expect(fromJsonString<string[]>('["bug","feature"]')).toEqual(['bug', 'feature']);
  });

  test('無効なJSON文字列でnullを返すこと', () => {
    expect(fromJsonString('invalid')).toBeNull();
  });

  test('オブジェクトをそのまま返すこと', () => {
    const obj = { key: 'value' };
    expect(fromJsonString<{ key: string }>(obj)).toBe(obj);
  });
});

describe('parseId', () => {
  test('有効な数値文字列をパースすること', () => {
    expect(parseId('123')).toBe(123);
    expect(parseId('0')).toBe(0);
    expect(parseId('999999')).toBe(999999);
  });

  test('無効な文字列でエラーをスローすること', () => {
    expect(() => parseId('abc')).toThrow('無効なIDです');
    expect(() => parseId('')).toThrow('無効なIDです');
  });

  test('小数点付き文字列は整数部分をパースすること', () => {
    expect(parseId('12.34')).toBe(12);
  });
});
