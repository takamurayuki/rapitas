/**
 * Mojibake Detector Test Suite
 *
 * Tests for mojibake detection and repair utilities.
 */
import { describe, test, expect } from 'bun:test';
import {
  detectMojibake,
  fixMojibake,
  sanitizeMarkdownContent,
  type MojibakeDetectionResult,
  type SanitizeResult,
} from '../../utils/common/mojibake-detector';

describe('Mojibake Detection', () => {
  test('正常なMarkdown（英語）を誤検出しないこと', () => {
    const cleanText = `# Hello World

This is a normal markdown document with English text.
- List item 1
- List item 2

\`\`\`javascript
const hello = "world";
console.log(hello);
\`\`\`
`;

    const result = detectMojibake(cleanText);
    expect(result.hasMojibake).toBe(false);
    expect(result.score).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  test('正常なMarkdown（日本語）を誤検出しないこと', () => {
    const cleanJapaneseText = `# こんにちは世界

これは日本語を含む正常なMarkdownドキュメントです。
- リスト項目1
- リスト項目2

## セクション
詳細な説明をここに記述します。
`;

    const result = detectMojibake(cleanJapaneseText);
    expect(result.hasMojibake).toBe(false);
    expect(result.score).toBe(0);
    expect(result.issues).toHaveLength(0);
  });

  test('UTF-8→Latin-1誤解釈パターンを検出すること', () => {
    // Example of "a" (U+3042) -> UTF-8(E3 81 82) -> Latin-1 misinterpretation
    const mojibakeText = `# ã\x81\x82Document

This text contains ã\x81\x82 characters that are mojibake.`;

    const result = detectMojibake(mojibakeText);
    expect(result.hasMojibake).toBe(true);
    expect(result.score).toBeGreaterThan(20);
    expect(result.patterns.utf8ToLatin1.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.includes('UTF-8→Latin-1誤解釈'))).toBe(true);
  });

  test('置換文字(U+FFFD)を検出すること', () => {
    const replacementText = `# Document with replacement chars

This text contains � replacement characters � that indicate encoding issues.`;

    const result = detectMojibake(replacementText);
    expect(result.hasMojibake).toBe(true);
    expect(result.score).toBeGreaterThan(20);
    expect(result.patterns.replacementChars).toBe(2);
    expect(result.issues.some((issue) => issue.includes('置換文字'))).toBe(true);
  });

  test('制御文字を検出すること', () => {
    const controlCharText = `# Document\x00with\x01control\x02chars

This text contains \x07 control characters.`;

    const result = detectMojibake(controlCharText);
    expect(result.hasMojibake).toBe(true);
    expect(result.score).toBeGreaterThan(20);
    expect(result.patterns.controlChars).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.includes('制御文字'))).toBe(true);
  });

  test('不正なサロゲートペア文字を検出すること', () => {
    const surrogateText = `# Document with surrogates

This text contains \uD800 invalid surrogate characters.`;

    const result = detectMojibake(surrogateText);
    expect(result.hasMojibake).toBe(true);
    expect(result.score).toBeGreaterThan(20);
    expect(result.patterns.invalidSequences.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.includes('サロゲートペア'))).toBe(true);
  });

  test('スコアが100を超えないこと', () => {
    // Text containing many mojibake patterns
    const heavyMojibakeText = `
      ã\x81\x82ã\x81\x84ã\x81\x86ã\x81\x88ã\x81\x8A
      ����������
      \x00\x01\x02\x03\x04\x05\x06\x07
      \uD800\uD800\uD800\uD800
    `;

    const result = detectMojibake(heavyMojibakeText);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('Mojibake Fixing', () => {
  test('置換文字(U+FFFD)を除去すること', () => {
    const textWithReplacements = `Hello � World � Test`;
    const fixed = fixMojibake(textWithReplacements);
    expect(fixed).toBe('Hello World Test'); // Whitespace normalization collapses consecutive spaces
    expect(fixed).not.toContain('�');
  });

  test('制御文字を除去すること（タブ・改行は保持）', () => {
    const textWithControls = `Hello\x00World\x01\nTest\t\x02End\x03`;
    const fixed = fixMojibake(textWithControls);
    expect(fixed).toBe('HelloWorld\nTest End'); // Tabs are also normalized to a single space
    expect(fixed).toContain('\n'); // Newlines are preserved
  });

  test('不正なサロゲートペア文字を除去すること', () => {
    const textWithSurrogates = `Hello\uD800World\uDFFFTest`;
    const fixed = fixMojibake(textWithSurrogates);
    expect(fixed).toBe('HelloWorldTest');
  });

  test('過剰な空白文字を正規化すること', () => {
    const textWithExtraSpaces = `Hello   \t  World`;
    const fixed = fixMojibake(textWithExtraSpaces);
    expect(fixed).toBe('Hello World');
  });

  test('過剰な改行を正規化すること', () => {
    const textWithExtraNewlines = `Line1\n\n\n\n\nLine2\n\n\n\nLine3`;
    const fixed = fixMojibake(textWithExtraNewlines);
    expect(fixed).toBe('Line1\n\nLine2\n\nLine3');
  });

  test('既知のUTF-8→Latin-1パターンを修復すること', () => {
    // Test repair of mojibake pattern for "aiueo"
    const knownPattern = `Ã£Â\x81\x82Ã£Â\x81\x84Ã£Â\x81\x86`;
    const fixed = fixMojibake(knownPattern);

    // Known pattern where full repair is expected
    expect(fixed).toContain('あいう');
  });

  test('日本語コンテキストで不正バイト列を除去すること', () => {
    const mixedText = `こんにちは\x80\x81\x82世界です`;
    const fixed = fixMojibake(mixedText);
    expect(fixed).toBe('こんにちは世界です');
  });

  test('正常な日本語テキストを破壊しないこと', () => {
    const normalJapanese = `こんにちは世界\nこれは正常な日本語テキストです。`;
    const fixed = fixMojibake(normalJapanese);
    expect(fixed).toBe(normalJapanese);
  });
});

describe('Markdown Content Sanitization', () => {
  test('正常なMarkdownを変更せずに返すこと', () => {
    const cleanMarkdown = `# Title

正常なMarkdownコンテンツです。

- リスト1
- リスト2

\`\`\`javascript
const code = "example";
\`\`\`
`;

    const result = sanitizeMarkdownContent(cleanMarkdown);
    expect(result.wasFixed).toBe(false);
    expect(result.content).toBe(cleanMarkdown);
    expect(result.issues).toHaveLength(0);
    expect(result.originalLength).toBe(cleanMarkdown.length);
    expect(result.fixedLength).toBe(cleanMarkdown.length);
  });

  test('文字化けを検出・修正すること', () => {
    const mojibakeMarkdown = `# Title with �

Content with ã\x81\x82 mojibake patterns.

- List item with \x00 control char
`;

    const result = sanitizeMarkdownContent(mojibakeMarkdown);
    expect(result.wasFixed).toBe(true);
    expect(result.content).not.toContain('�');
    expect(result.content).not.toContain('\x00');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.includes('文字化けを修正'))).toBe(true);
  });

  test('修正後にスコアが改善されない場合は元テキストを保持すること', () => {
    // This test depends on the actual fix logic behavior,
    // so creating special cases is difficult. Limited to basic behavior check.
    const ambiguousText = `Ambiguous text that might not benefit from fixing`;
    const result = sanitizeMarkdownContent(ambiguousText);

    // If no mojibake is detected, no fix is applied
    expect(result.content).toBe(ambiguousText);
  });

  test('大きなファイルでもパフォーマンスが適切であること', () => {
    // Performance test with ~10KB of text
    const largeText = `# Large Document\n\n${'正常な日本語テキストの繰り返し。'.repeat(500)}`;

    const startTime = Date.now();
    const result = sanitizeMarkdownContent(largeText);
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(1000); // Within 1 second
    expect(result.content).toBe(largeText); // Normal text is not modified
    expect(result.wasFixed).toBe(false);
  });

  test('複合的な文字化けパターンを適切に処理すること', () => {
    const complexMojibake = `# Title

ã\x81\x82 multiple ã\x81\x84 patterns � with \x00 different \uD800 types.

- List with ã\x81\x86
- Another � item
`;

    const result = sanitizeMarkdownContent(complexMojibake);
    expect(result.wasFixed).toBe(true);
    expect(result.content).not.toContain('�');
    expect(result.content).not.toContain('\x00');
    expect(result.content).not.toContain('\uD800');
    expect(result.issues.length).toBeGreaterThan(1); // Multiple issues should be reported
  });

  test('結果オブジェクトが適切な情報を含むこと', () => {
    const testText = `Test with � replacement`;
    const result = sanitizeMarkdownContent(testText);

    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('wasFixed');
    expect(result).toHaveProperty('issues');
    expect(result).toHaveProperty('originalLength');
    expect(result).toHaveProperty('fixedLength');

    expect(typeof result.content).toBe('string');
    expect(typeof result.wasFixed).toBe('boolean');
    expect(Array.isArray(result.issues)).toBe(true);
    expect(typeof result.originalLength).toBe('number');
    expect(typeof result.fixedLength).toBe('number');
  });
});

describe('Edge Cases', () => {
  test('空文字列を適切に処理すること', () => {
    const result = sanitizeMarkdownContent('');
    expect(result.content).toBe('');
    expect(result.wasFixed).toBe(false);
    expect(result.originalLength).toBe(0);
    expect(result.fixedLength).toBe(0);
  });

  test('非常に短いテキストを適切に処理すること', () => {
    const result = sanitizeMarkdownContent('a');
    expect(result.content).toBe('a');
    expect(result.wasFixed).toBe(false);
  });

  test('改行のみのテキストを適切に処理すること', () => {
    const result = sanitizeMarkdownContent('\n\n\n');
    expect(result.content).toBe('\n\n\n'); // No mojibake detected, so no processing
    expect(result.wasFixed).toBe(false); // No mojibake fix applied
  });

  test('スペースのみのテキストを適切に処理すること', () => {
    const result = sanitizeMarkdownContent('   \t   ');
    expect(result.content).toBe('   \t   '); // No mojibake detected, so no processing
    expect(result.wasFixed).toBe(false); // No mojibake fix applied
  });
});
