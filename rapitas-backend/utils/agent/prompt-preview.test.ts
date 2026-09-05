/**
 * prompt-preview.test
 *
 * The banner preview must be one line, skip leading headings, and cap length.
 */
import { describe, test, expect } from 'bun:test';
import { formatPromptPreview } from './prompt-preview';

describe('formatPromptPreview', () => {
  test('collapses a multi-line prompt into a single line', () => {
    const preview = formatPromptPreview(
      'あなたはリサーチャーです。\n\n調査してください。\n  - 依存関係',
    );
    expect(preview).toBe('あなたはリサーチャーです。 調査してください。 - 依存関係');
    expect(preview).not.toContain('\n');
  });

  test('drops leading markdown headings so the preview starts with the instruction', () => {
    const preview = formatPromptPreview(
      '## システム指示\nあなたはコードベースの調査を担当するリサーチャーです。',
    );
    expect(preview.startsWith('あなたはコードベースの調査')).toBe(true);
  });

  test('keeps headings that appear after the first body line', () => {
    const preview = formatPromptPreview('本文\n## 手順\n1. 調べる');
    expect(preview).toBe('本文 ## 手順 1. 調べる');
  });

  test('truncates to the cap with an ellipsis', () => {
    const preview = formatPromptPreview('x'.repeat(500), 200);
    expect(preview.length).toBe(203);
    expect(preview.endsWith('...')).toBe(true);
  });

  test('returns an empty string for a heading-only prompt', () => {
    expect(formatPromptPreview('## Only a heading')).toBe('');
  });
});
