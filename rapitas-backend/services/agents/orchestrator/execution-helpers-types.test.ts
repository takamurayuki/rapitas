/**
 * execution-helpers-types ユニットテスト
 *
 * toJsonString() の分岐（null/undefined → null、文字列はそのまま返す、
 * それ以外は JSON.stringify）を検証する。他のエクスポートは型のみのため対象外。
 */
import { describe, expect, test } from 'bun:test';
import { toJsonString } from './execution-helpers-types';

describe('toJsonString', () => {
  test('null → null', () => {
    expect(toJsonString(null)).toBeNull();
  });

  test('undefined → null', () => {
    expect(toJsonString(undefined)).toBeNull();
  });

  test('文字列はそのまま返す（二重エンコードしない）', () => {
    expect(toJsonString('already a string')).toBe('already a string');
  });

  test('空文字はそのまま返す（falsy だが null 分岐には入らない）', () => {
    expect(toJsonString('')).toBe('');
  });

  test('数値は JSON.stringify される', () => {
    expect(toJsonString(42)).toBe('42');
  });

  test('真偽値は JSON.stringify される', () => {
    expect(toJsonString(true)).toBe('true');
  });

  test('配列は JSON.stringify される', () => {
    expect(toJsonString([1, 2, 3])).toBe('[1,2,3]');
  });

  test('オブジェクトは JSON.stringify される', () => {
    expect(toJsonString({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}');
  });

  test('ネストしたオブジェクトも JSON.stringify される', () => {
    expect(toJsonString({ nested: { value: [1, null] } })).toBe('{"nested":{"value":[1,null]}}');
  });
});
