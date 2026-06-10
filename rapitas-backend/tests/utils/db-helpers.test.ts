/**
 * Database Helper Utilities テスト
 * JSON変換、ID解析、プロバイダー判定、インセンシティブフィルタ構築の純粋関数のテスト
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  getLabelsArray,
  toJsonString,
  fromJsonString,
  parseId,
  isPostgresProvider,
  insensitiveContains,
  insensitiveEquals,
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

// isPostgresProvider / insensitiveContains / insensitiveEquals の env 分岐テスト
// 各 test の前後で env を保存・復元し、テスト間の副作用を防ぐ。
describe('isPostgresProvider', () => {
  let savedProvider: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  test('RAPITAS_DB_PROVIDER=sqlite のとき false を返すこと', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(isPostgresProvider()).toBe(false);
  });

  test('DATABASE_URL が file: で始まるとき false を返すこと', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(isPostgresProvider()).toBe(false);
  });

  test('RAPITAS_DB_PROVIDER=postgresql のとき true を返すこと', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://localhost/db';
    expect(isPostgresProvider()).toBe(true);
  });

  test('両変数が未設定のとき true を返すこと（デフォルトは Postgres）', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
    expect(isPostgresProvider()).toBe(true);
  });
});

describe('insensitiveContains', () => {
  let savedProvider: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  test('Postgres 環境では mode を含む contains フィルタを返すこと', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://localhost/db';
    expect(insensitiveContains('hello')).toEqual({ contains: 'hello', mode: 'insensitive' });
  });

  test('SQLite 環境では mode を含まない contains フィルタを返すこと', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(insensitiveContains('hello')).toEqual({ contains: 'hello' });
  });

  test('file: DATABASE_URL のとき mode を含まないこと', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(insensitiveContains('world')).toEqual({ contains: 'world' });
  });
});

describe('insensitiveEquals', () => {
  let savedProvider: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedUrl = process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  test('Postgres 環境では mode を含む equals フィルタを返すこと', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'postgresql://localhost/db';
    expect(insensitiveEquals('Task A')).toEqual({ equals: 'Task A', mode: 'insensitive' });
  });

  test('SQLite 環境では mode を含まない equals フィルタを返すこと', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    delete process.env.DATABASE_URL;
    expect(insensitiveEquals('Task A')).toEqual({ equals: 'Task A' });
  });

  test('file: DATABASE_URL のとき mode を含まないこと', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(insensitiveEquals('Task A')).toEqual({ equals: 'Task A' });
  });
});
