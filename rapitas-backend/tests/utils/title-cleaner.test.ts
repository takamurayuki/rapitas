/**
 * title-cleaner テスト
 * LLM生成タイトルのクリーニング（前置き除去・引用符除去・省略等）のテスト
 */
import { describe, test, expect } from 'bun:test';
import { cleanGeneratedTitle } from '../../utils/common/title-cleaner';

describe('cleanGeneratedTitle - basic trimming', () => {
  test('前後の空白を除去すること', () => {
    expect(cleanGeneratedTitle('  タスク名  ')).toBe('タスク名');
  });

  test('空文字列はそのまま空文字列を返すこと', () => {
    expect(cleanGeneratedTitle('')).toBe('');
  });

  test('空白のみの文字列は空文字列を返すこと', () => {
    expect(cleanGeneratedTitle('   \n  ')).toBe('');
  });

  test('複数行の場合は最初の行のみ使用すること', () => {
    expect(cleanGeneratedTitle('タスク名\nこれは説明文です')).toBe('タスク名');
  });
});

describe('cleanGeneratedTitle - quote/bracket stripping', () => {
  test('二重引用符を除去すること', () => {
    expect(cleanGeneratedTitle('"タスク名"')).toBe('タスク名');
  });

  test('単一引用符を除去すること', () => {
    expect(cleanGeneratedTitle("'タスク名'")).toBe('タスク名');
  });

  test('鉤括弧「」を除去すること', () => {
    expect(cleanGeneratedTitle('「タスク名」')).toBe('タスク名');
  });

  test('二重鉤括弧『』を除去すること', () => {
    expect(cleanGeneratedTitle('『タスク名』')).toBe('タスク名');
  });

  test('隅付き括弧【】を除去すること', () => {
    expect(cleanGeneratedTitle('【タスク名】')).toBe('タスク名');
  });

  test('半角角括弧を除去すること', () => {
    expect(cleanGeneratedTitle('[タスク名]')).toBe('タスク名');
  });

  test('半角丸括弧を除去すること', () => {
    expect(cleanGeneratedTitle('(タスク名)')).toBe('タスク名');
  });

  test('全角丸括弧を除去すること', () => {
    expect(cleanGeneratedTitle('（タスク名）')).toBe('タスク名');
  });
});

describe('cleanGeneratedTitle - prefix stripping', () => {
  test('「タイトル:」プレフィックスを除去すること', () => {
    expect(cleanGeneratedTitle('タイトル: 会議の準備')).toBe('会議の準備');
  });

  test('全角コロンの「件名：」プレフィックスを除去すること', () => {
    expect(cleanGeneratedTitle('件名：会議の準備')).toBe('会議の準備');
  });

  test('「題名:」プレフィックスを除去すること', () => {
    expect(cleanGeneratedTitle('題名: 会議の準備')).toBe('会議の準備');
  });

  test('英語の"Title:"プレフィックス（大文字小文字問わず）を除去すること', () => {
    expect(cleanGeneratedTitle('Title: Prepare meeting')).toBe('Prepare meeting');
    expect(cleanGeneratedTitle('TITLE: Prepare meeting')).toBe('Prepare meeting');
  });

  test('番号プレフィックス「1. 」を除去すること', () => {
    expect(cleanGeneratedTitle('1. タスク名')).toBe('タスク名');
  });

  test('番号プレフィックス「12) 」を除去すること', () => {
    expect(cleanGeneratedTitle('12) タスク名')).toBe('タスク名');
  });

  test('箇条書きプレフィックス「- 」を除去すること', () => {
    expect(cleanGeneratedTitle('- タスク名')).toBe('タスク名');
  });

  test('箇条書きプレフィックス「・」を除去すること', () => {
    expect(cleanGeneratedTitle('・タスク名')).toBe('タスク名');
  });

  test('プレフィックス除去後に露出した引用符を再度除去すること', () => {
    expect(cleanGeneratedTitle('1. "タスク名"')).toBe('タスク名');
  });
});

describe('cleanGeneratedTitle - trailing punctuation and sentence splitting', () => {
  test('末尾の感嘆符を除去すること', () => {
    expect(cleanGeneratedTitle('やったね!')).toBe('やったね');
  });

  test('末尾の疑問符を除去すること', () => {
    expect(cleanGeneratedTitle('本当に直った？')).toBe('本当に直った');
  });

  test('末尾の連続した記号をまとめて除去すること', () => {
    expect(cleanGeneratedTitle('最高だ!!!')).toBe('最高だ');
  });

  test('複数文がある場合は最初の文のみ使用すること', () => {
    expect(cleanGeneratedTitle('これはテストです。これは2文目です。')).toBe('これはテストです');
  });
});

describe('cleanGeneratedTitle - hyphen handling', () => {
  test('純粋な英数字ハイフン区切りはスペース区切りに変換すること', () => {
    expect(cleanGeneratedTitle('fix-user-auth')).toBe('fix user auth');
  });

  test('大文字混じりの英数字ハイフン区切りも変換すること', () => {
    expect(cleanGeneratedTitle('User-Auth-Fix')).toBe('User Auth Fix');
  });

  test('日本語混じりのハイフン区切りをスペースに変換すること', () => {
    expect(cleanGeneratedTitle('日本語-テスト')).toBe('日本語 テスト');
  });

  test('日本語混じりのダッシュ（emダッシュ）をスペースに変換すること', () => {
    expect(cleanGeneratedTitle('日本語—テスト')).toBe('日本語 テスト');
  });

  test('数字とハイフンのみの文字列も分割されること（既知の仕様）', () => {
    expect(cleanGeneratedTitle('2024-01-01')).toBe('2024 01 01');
  });
});

describe('cleanGeneratedTitle - whitespace normalization', () => {
  test('連続する空白を1つにまとめること', () => {
    expect(cleanGeneratedTitle('タスク   名前')).toBe('タスク 名前');
  });
});

describe('cleanGeneratedTitle - 40 character truncation', () => {
  test('40文字以下の場合は切り詰めないこと', () => {
    const title = 'あ'.repeat(40);
    expect(cleanGeneratedTitle(title)).toBe(title);
  });

  test('助詞が21文字目以降にある場合はその助詞の直後で切ること', () => {
    const filler1 = 'あ'.repeat(25); // indices 0-24, no particle chars
    const filler2 = 'い'.repeat(20); // indices 26-45, no particle chars
    const raw = `${filler1}の${filler2}`; // 'の' at index 25
    const result = cleanGeneratedTitle(raw);
    expect(result).toBe(`${filler1}の`);
    expect(result.length).toBe(26);
  });

  test('助詞が20文字目以前にしかない場合は単純に40文字で切ること', () => {
    const raw = `${'あ'.repeat(5)}の${'あ'.repeat(60)}`; // last particle at index 5
    const result = cleanGeneratedTitle(raw);
    expect(result).toBe(raw.slice(0, 40));
    expect(result.length).toBe(40);
  });

  test('助詞が全く含まれない場合は単純に40文字で切ること', () => {
    const raw = 'あ'.repeat(60);
    const result = cleanGeneratedTitle(raw);
    expect(result).toBe(raw.slice(0, 40));
    expect(result.length).toBe(40);
  });
});
