/**
 * mojibake-detector ユニットテスト
 *
 * 文字化け検出(detectMojibake)・修復(fixMojibake)・サニタイズの
 * 統合エントリ(sanitizeMarkdownContent)・不可逆な '?' 化け検出
 * (detectReplacementLoss) を実実装で検証する。外部依存なしの純粋関数群。
 */
import { describe, test, expect } from 'bun:test';
import {
  detectMojibake,
  fixMojibake,
  sanitizeMarkdownContent,
  detectReplacementLoss,
} from './mojibake-detector';

describe('detectMojibake', () => {
  test('clean ASCII text has no mojibake', () => {
    const result = detectMojibake('Hello, this is a normal sentence.');
    expect(result.hasMojibake).toBe(false);
    expect(result.score).toBe(0);
    expect(result.issues).toEqual([]);
  });

  test('clean Japanese text has no mojibake', () => {
    const result = detectMojibake('これは正常な日本語の文章です。');
    expect(result.hasMojibake).toBe(false);
    expect(result.score).toBe(0);
  });

  test('detects replacement characters (U+FFFD)', () => {
    const result = detectMojibake('broken��text');
    expect(result.patterns.replacementChars).toBe(2);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.hasMojibake).toBe(true);
  });

  test('a single control character alone stays below the mojibake threshold', () => {
    const result = detectMojibake('normal\x00text');
    expect(result.patterns.controlChars).toBe(1);
    expect(result.score).toBe(10);
    expect(result.hasMojibake).toBe(false);
  });

  test('detects lone surrogate characters as invalid sequences', () => {
    const result = detectMojibake('text\uD800text');
    expect(result.patterns.invalidSequences.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.hasMojibake).toBe(true);
  });

  test('detects a known UTF-8 -> Latin-1 misinterpretation pattern', () => {
    // "あ" corrupted via UTF-8 bytes (E3 81 82) misread as Latin-1.
    const broken = 'Ã£Â\x81\x82';
    const result = detectMojibake(broken);
    expect(result.patterns.utf8ToLatin1.length).toBeGreaterThan(0);
    expect(result.hasMojibake).toBe(true);
  });

  test('detects Windows-1252 double-encoded curly quotes', () => {
    const result = detectMojibake('â€œquotedâ€\x9D');
    expect(result.patterns.invalidSequences.length).toBeGreaterThan(0);
  });

  test('score is capped at 100 even with heavy corruption', () => {
    const result = detectMojibake('�'.repeat(20));
    expect(result.score).toBe(100);
  });
});

describe('fixMojibake', () => {
  test('strips replacement characters', () => {
    expect(fixMojibake('a�b')).toBe('ab');
  });

  test('strips null control characters (tab is later normalized to a space, newline is preserved)', () => {
    const fixed = fixMojibake('a\x00b\tc\nd\re');
    expect(fixed).not.toContain('\x00');
    expect(fixed).toContain('\n');
  });

  test('strips lone surrogate characters', () => {
    const fixed = fixMojibake('a\uD800b');
    expect(fixed).toBe('ab');
  });

  test('repairs known Japanese UTF-8/Latin-1 misinterpretation patterns', () => {
    const fixed = fixMojibake('Ã£Â\x81\x82Ã£Â\x81\x84');
    expect(fixed).toBe('あい');
  });

  test('repairs Windows-1252 double-encoded curly quotes', () => {
    const fixed = fixMojibake('â€œhelloâ€\x9D');
    expect(fixed).toBe('"hello"');
  });

  test('collapses 3+ consecutive newlines to 2', () => {
    const fixed = fixMojibake('a\n\n\n\nb');
    expect(fixed).toBe('a\n\nb');
  });

  test('collapses consecutive spaces/tabs to a single space', () => {
    const fixed = fixMojibake('a    b\t\tc');
    expect(fixed).toBe('a b c');
  });

  test('trims leading/trailing whitespace', () => {
    expect(fixMojibake('  hello  ')).toBe('hello');
  });

  test('is a no-op (aside from whitespace trim) on already-clean text', () => {
    expect(fixMojibake('Hello world')).toBe('Hello world');
  });
});

describe('sanitizeMarkdownContent', () => {
  test('leaves clean text untouched and reports no fix', () => {
    const result = sanitizeMarkdownContent('Hello world');
    expect(result.wasFixed).toBe(false);
    expect(result.content).toBe('Hello world');
    expect(result.issues).toEqual([]);
  });

  test('fixes text with replacement characters and reports wasFixed', () => {
    const result = sanitizeMarkdownContent('broken��text');
    expect(result.wasFixed).toBe(true);
    expect(result.content).not.toContain('�');
    expect(result.issues.length).toBeGreaterThan(0);
  });

  test('reports original/fixed length', () => {
    const original = 'broken�text';
    const result = sanitizeMarkdownContent(original);
    expect(result.originalLength).toBe(original.length);
    expect(result.fixedLength).toBe(result.content.length);
  });
});

describe('detectReplacementLoss', () => {
  test('clean text has no replacement loss', () => {
    const result = detectReplacementLoss('Hello, is this a real question?');
    expect(result.detected).toBe(false);
    expect(result.runs).toBe(0);
  });

  test('a lone nullish-coalescing-style "??" is not flagged', () => {
    const result = detectReplacementLoss('const x = a ?? b;');
    expect(result.detected).toBe(false);
  });

  test('detects a single long run of "?" as corruption', () => {
    const result = detectReplacementLoss('word1 ???????? word2');
    expect(result.longest).toBeGreaterThanOrEqual(8);
    expect(result.detected).toBe(true);
  });

  test('detects several separate 3+ "?" runs as corruption', () => {
    const result = detectReplacementLoss('??? one ??? two ??? three');
    expect(result.runs).toBe(3);
    expect(result.detected).toBe(true);
  });

  test('two isolated 3-"?" runs do not meet the 3-run threshold', () => {
    const result = detectReplacementLoss('??? one ??? two');
    expect(result.runs).toBe(2);
    expect(result.detected).toBe(false);
  });

  test('counts total "?" characters across all runs', () => {
    const result = detectReplacementLoss('???? ????');
    expect(result.count).toBe(8);
  });
});
