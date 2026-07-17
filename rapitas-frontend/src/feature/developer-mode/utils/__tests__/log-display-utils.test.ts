/**
 * log-display-utils tests
 *
 * Unit tests for the pure render-prep helpers: markdown stripping/collapsing,
 * narrative-prose detection, and consecutive-duplicate grouping.
 */
import {
  collapseMarkdownBlocks,
  dedupeConsecutiveEntries,
  isMarkdownMarkerLine,
  isNarrativeProse,
  stripMarkdownDecorations,
  summarizeInstruction,
  type MarkdownBlockToken,
} from '../log-display-utils';
import type { UserFriendlyLogEntry } from '../log-pattern-rules';

describe('stripMarkdownDecorations', () => {
  test('strips heading hashes', () => {
    expect(stripMarkdownDecorations('## 概要')).toBe('概要');
  });

  test('strips bold, inline code, and bullet markers but keeps content', () => {
    expect(stripMarkdownDecorations('- **重要**: `config.ts` を確認')).toBe(
      '重要: config.ts を確認',
    );
  });

  test('leaves plain text unchanged', () => {
    expect(stripMarkdownDecorations('plain message')).toBe('plain message');
  });
});

describe('isMarkdownMarkerLine', () => {
  test('detects headings, bullets, fences, and table rows', () => {
    expect(isMarkdownMarkerLine('# Title')).toBe(true);
    expect(isMarkdownMarkerLine('- item')).toBe(true);
    expect(isMarkdownMarkerLine('```ts')).toBe(true);
    expect(isMarkdownMarkerLine('| col | col |')).toBe(true);
  });

  test('rejects ordinary prose and tagged log lines', () => {
    expect(isMarkdownMarkerLine('普通の文章です')).toBe(false);
    expect(isMarkdownMarkerLine('[Tool: Read] -> a.ts')).toBe(false);
  });
});

describe('isNarrativeProse', () => {
  test('any kana implies a Japanese sentence', () => {
    expect(isNarrativeProse('調査がまとまったので保存します')).toBe(true);
  });

  test('English narrative openers qualify', () => {
    expect(isNarrativeProse('Let me check the store next')).toBe(true);
    expect(isNarrativeProse('I will update the schema')).toBe(true);
  });

  test('sentence-ending punctuation with enough words qualifies', () => {
    expect(isNarrativeProse('The migration completed without any errors.')).toBe(true);
  });

  test('tagged lines, fragments, and paths do not qualify', () => {
    expect(isNarrativeProse('[Tool: Bash] $ ls')).toBe(false);
    expect(isNarrativeProse('Done.')).toBe(false);
    expect(isNarrativeProse('src/utils/foo.ts')).toBe(false);
  });
});

describe('collapseMarkdownBlocks', () => {
  test('collapses a heading-led run into one token with fileName from context', () => {
    const lines = [
      'research.md を保存します',
      '## 調査結果',
      '- 依存関係あり',
      '- 重複なし',
      '結論として問題ない',
      '[Tool: Write] -> research.md',
    ];
    const result = collapseMarkdownBlocks(lines);
    expect(result).toHaveLength(3);
    const token = result[1] as MarkdownBlockToken;
    expect(token.kind).toBe('markdown-block');
    expect(token.fileName).toBe('research.md');
    expect(token.content).toContain('## 調査結果');
    expect(token.content).toContain('結論として問題ない');
    expect(token.charCount).toBe(token.content.length);
    // The tagged boundary line is preserved as-is after the block.
    expect(result[2]).toBe('[Tool: Write] -> research.md');
  });

  test('a short md run (under 3 lines) passes through unchanged', () => {
    const lines = ['## lone heading', 'prose', '[Tool: Read] -> a.ts'];
    const result = collapseMarkdownBlocks(lines);
    expect(result).toEqual(lines);
  });

  test('non-markdown lines are returned untouched', () => {
    const lines = ['普通のログ', '[Tool: Read] -> a.ts'];
    expect(collapseMarkdownBlocks(lines)).toEqual(lines);
  });
});

describe('summarizeInstruction', () => {
  test('strips markdown from the first meaningful line', () => {
    expect(summarizeInstruction('## システム指示')).toBe('システム指示');
  });

  test('skips leading blank lines and cuts at the first sentence end', () => {
    expect(summarizeInstruction('\nタスクを実装してください。詳細は以下。')).toBe(
      'タスクを実装してください。',
    );
  });

  test('a period inside an identifier does not end the sentence', () => {
    expect(summarizeInstruction('Update config.ts as needed')).toBe('Update config.ts as needed');
  });

  test('caps very long summaries at 120 chars', () => {
    expect(summarizeInstruction('y'.repeat(200))).toBe(`${'y'.repeat(120)}...`);
  });
});

describe('dedupeConsecutiveEntries', () => {
  function entry(message: string, category: UserFriendlyLogEntry['category'] = 'progress') {
    return { category, message } as UserFriendlyLogEntry;
  }

  test('merges consecutive identical entries into one with a count', () => {
    const input = [entry('思考中…'), entry('思考中…'), entry('思考中…')];
    const result = dedupeConsecutiveEntries(input);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
  });

  test('does not merge non-adjacent duplicates by default (lookback 1)', () => {
    const input = [entry('a'), entry('b'), entry('a')];
    const result = dedupeConsecutiveEntries(input);
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.count === undefined)).toBe(true);
  });

  test('with a lookback window, near (non-adjacent) duplicates merge into the earlier entry', () => {
    // Same event emitted by two log sources a few entries apart.
    const input = [
      entry('verify.md を保存しました', 'info'),
      entry('x'),
      entry('verify.md を保存しました', 'info'),
    ];
    const result = dedupeConsecutiveEntries(input, 6);
    expect(result).toHaveLength(2);
    expect(result[0].count).toBe(2);
    expect(result[1].message).toBe('x');
  });

  test('duplicates outside the lookback window stay separate', () => {
    const input = [entry('dup', 'info'), entry('1'), entry('2'), entry('dup', 'info')];
    const result = dedupeConsecutiveEntries(input, 2);
    expect(result).toHaveLength(4);
  });

  test('entries differing only in detail are kept separate', () => {
    const input: UserFriendlyLogEntry[] = [
      { category: 'info', message: 'm', detail: 'x' },
      { category: 'info', message: 'm', detail: 'y' },
    ];
    expect(dedupeConsecutiveEntries(input)).toHaveLength(2);
  });

  test('accumulates pre-existing counts and never mutates the input', () => {
    const first: UserFriendlyLogEntry = { category: 'progress', message: 'm', count: 2 };
    const second: UserFriendlyLogEntry = { category: 'progress', message: 'm' };
    const result = dedupeConsecutiveEntries([first, second]);
    expect(result[0].count).toBe(3);
    expect(first.count).toBe(2); // input untouched
  });
});
