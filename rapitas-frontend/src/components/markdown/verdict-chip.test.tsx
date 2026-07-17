/**
 * Tests for verdict-chip
 *
 * Covers whole-line verdict phrases (ja + en) rendering as status pills,
 * qualifier suffixes, bold-wrapped phrases, and the phrase-vs-inline-item
 * distinction (partial lines fall back to inline icon substitution).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { renderBlockWithEmojiIcons } from './verdict-chip';

const renderBlock = (node: ReactNode) => render(<p>{renderBlockWithEmojiIcons(node)}</p>);

const getChip = (container: HTMLElement) => container.querySelector('span.rounded-full');

describe('renderBlockWithEmojiIcons', () => {
  describe('whole-line verdict phrases render as chips', () => {
    it.each([
      { input: '✅ 検証成功', text: '検証成功', tone: 'green' },
      { input: '❌ 検証失敗', text: '検証失敗', tone: 'red' },
      { input: '⚠️ 一部失敗', text: '一部失敗', tone: 'amber' },
      { input: '✅ Pass', text: 'Pass', tone: 'green' },
      { input: '❌ Fail', text: 'Fail', tone: 'red' },
      { input: '⚠️ Partial', text: 'Partial', tone: 'amber' },
    ])('"$input" → $tone chip "$text"', ({ input, text, tone }) => {
      const { container } = renderBlock(input);
      const chip = getChip(container);
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toBe(text);
      expect(chip?.getAttribute('class')).toContain(`border-${tone}-300`);
      // Icon lives inside the chip.
      expect(chip?.querySelector('svg')).not.toBeNull();
    });

    it.each([
      { input: '✅ 検証成功（修正不要）', expected: '検証成功（修正不要）' },
      { input: '✅ Pass (no change needed)', expected: 'Pass (no change needed)' },
    ])('keeps the qualifier: "$input"', ({ input, expected }) => {
      const { container } = renderBlock(input);
      expect(getChip(container)?.textContent).toBe(expected);
    });

    it('renders a chip for a bold-wrapped verdict', () => {
      const { container } = renderBlock(<strong>❌ 検証失敗</strong>);
      const chip = getChip(container);
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toBe('検証失敗');
      expect(chip?.getAttribute('class')).toContain('border-red-300');
    });

    it('trims surrounding whitespace before matching', () => {
      const { container } = renderBlock('  ✅ 検証成功  ');
      expect(getChip(container)).not.toBeNull();
    });
  });

  describe('non-verdict lines fall back to inline substitution', () => {
    it.each([
      '結果: ✅ 検証成功',
      '✅ 検証成功 と判断した',
      '✅ 完了: サブタスクA',
      '⚠️ 一部失敗が2件ある',
    ])('"%s" is not a chip but still gets an icon', (input) => {
      const { container, getByRole } = renderBlock(input);
      expect(getChip(container)).toBeNull();
      expect(getByRole('img')).toBeInTheDocument();
    });

    it('plain text without emoji is returned untouched', () => {
      const { container } = renderBlock('ただの段落テキスト');
      expect(getChip(container)).toBeNull();
      expect(container.textContent).toBe('ただの段落テキスト');
    });
  });
});
