/**
 * json-extractor.test
 *
 * Unit tests for extractFirstJsonArray and parseJsonArray.
 */
import { describe, it, expect } from 'bun:test';
import { extractFirstJsonArray, parseJsonArray } from './json-extractor';

describe('extractFirstJsonArray', () => {
  it('正常な JSON 配列のみの入力 — 全体を返す', () => {
    const input = '[{"title":"A","scope":["a.ts"]}]';
    const result = extractFirstJsonArray(input);
    expect(result).toBe(input);
    expect(JSON.parse(result!)).toEqual([{ title: 'A', scope: ['a.ts'] }]);
  });

  it('コードフェンス付き — 配列部分のみ返す', () => {
    const input = '```json\n[{"title":"B"}]\n```';
    const result = extractFirstJsonArray(input);
    expect(result).toBe('[{"title":"B"}]');
    expect(JSON.parse(result!)).toEqual([{ title: 'B' }]);
  });

  it('末尾に説明文（]を含む）がある場合 — 配列本体のみ返す（後続 ] を取り込まない）', () => {
    const input = '[{"title":"C"}]\n参考: [CLAUDE.md の制約を参照]';
    const result = extractFirstJsonArray(input);
    expect(result).toBe('[{"title":"C"}]');
    expect(JSON.parse(result!)).toEqual([{ title: 'C' }]);
  });

  it('トークン切断（閉じ ] なし）— null を返す', () => {
    const input = '[{"title":"D","instructions":["手順1","手順2: ファイル';
    const result = extractFirstJsonArray(input);
    expect(result).toBeNull();
  });

  it('文字列値に ] を含む — 正しく確定する', () => {
    const input = '[{"title":"配列[0]を参照"}]';
    const result = extractFirstJsonArray(input);
    expect(result).toBe('[{"title":"配列[0]を参照"}]');
    expect(JSON.parse(result!)).toEqual([{ title: '配列[0]を参照' }]);
  });

  it('文字列値にエスケープされた " を含む — 正しく確定する', () => {
    const input = '[{"title":"彼は\\"hello\\"と言った"}]';
    const result = extractFirstJsonArray(input);
    expect(result).toBe('[{"title":"彼は\\"hello\\"と言った"}]');
    expect(JSON.parse(result!)).toEqual([{ title: '彼は"hello"と言った' }]);
  });

  it('[ が無い入力 — null を返す', () => {
    const result = extractFirstJsonArray('テキストのみ。配列なし');
    expect(result).toBeNull();
  });

  it('空文字列 — null を返す', () => {
    const result = extractFirstJsonArray('');
    expect(result).toBeNull();
  });

  it('ネストした配列を含む JSON — 最外の配列全体を返す', () => {
    const input = '[{"scope":["a.ts","b.ts"],"tags":["fix","perf"]}]';
    const result = extractFirstJsonArray(input);
    expect(result).toBe(input);
    expect(JSON.parse(result!)).toEqual([{ scope: ['a.ts', 'b.ts'], tags: ['fix', 'perf'] }]);
  });

  it('前置きテキストがある場合でも配列を抽出する', () => {
    const input = 'こちらが生成したサブタスクリストです:\n[{"title":"E"}]\nよろしくお願いします。';
    const result = extractFirstJsonArray(input);
    expect(result).toBe('[{"title":"E"}]');
    expect(JSON.parse(result!)).toEqual([{ title: 'E' }]);
  });
});

describe('parseJsonArray', () => {
  it('正常な JSON 配列 — 型付き配列を返す', () => {
    const input = '[{"id":1},{"id":2}]';
    const result = parseJsonArray<{ id: number }>(input);
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('コードフェンス付きテキスト — 配列を返す', () => {
    const input = '以下の通りです:\n```json\n[{"title":"A"}]\n```';
    const result = parseJsonArray<{ title: string }>(input);
    expect(result).toEqual([{ title: 'A' }]);
  });

  it('JSON 配列なし — null を返す', () => {
    expect(parseJsonArray('テキストのみ')).toBeNull();
  });

  it('未終端 JSON — null を返す', () => {
    expect(parseJsonArray('[{"title":"truncated')).toBeNull();
  });

  it('不正な JSON（配列ではなくオブジェクト） — null を返す', () => {
    // extractFirstJsonArray returns null for plain objects; parseJsonArray propagates
    expect(parseJsonArray('{"key":"value"}')).toBeNull();
  });

  it('壊れた JSON — null を返す', () => {
    // bracket counter finds a closed bracket but JSON.parse fails
    expect(parseJsonArray('[{invalid}]')).toBeNull();
  });

  it('空配列 — 空配列を返す', () => {
    const result = parseJsonArray<{ id: number }>('[]');
    expect(result).toEqual([]);
  });
});
