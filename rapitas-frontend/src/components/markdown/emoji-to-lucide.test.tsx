/**
 * Tests for emoji-to-lucide
 *
 * Covers the fixed emoji→icon map, mixed-text preservation, unknown-emoji
 * passthrough, variation-selector normalisation, and redundant-status-word
 * collapsing.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  isIconOnlyCellContent,
  renderTextWithEmojiIcons,
  unwrapFullQuotes,
} from './emoji-to-lucide';
import { MarkdownView } from './MarkdownView';

const renderText = (text: string) => render(<div>{renderTextWithEmojiIcons(text)}</div>);

describe('renderTextWithEmojiIcons', () => {
  describe('mapped emoji become the right lucide icon', () => {
    it.each([
      { emoji: '✅', label: 'success', iconClass: 'lucide-check', colorClass: 'text-green-500' },
      { emoji: '❌', label: 'failure', iconClass: 'lucide-x', colorClass: 'text-red-500' },
      {
        emoji: '⚠️',
        label: 'warning',
        iconClass: 'lucide-triangle-alert',
        colorClass: 'text-amber-500',
      },
      { emoji: 'ℹ️', label: 'info', iconClass: 'lucide-info', colorClass: 'text-sky-500' },
      { emoji: '💡', label: 'hint', iconClass: 'lucide-info', colorClass: 'text-sky-500' },
      { emoji: '📝', label: 'note', iconClass: 'lucide-file-text', colorClass: 'text-zinc-400' },
      { emoji: '⏳', label: 'pending', iconClass: 'lucide-clock', colorClass: 'text-zinc-400' },
      // Legacy seed-vocabulary set (round 8) — with and without U+FE0F.
      {
        emoji: '⏭️',
        label: 'skipped',
        iconClass: 'lucide-skip-forward',
        colorClass: 'text-zinc-400',
      },
      {
        emoji: '⏭',
        label: 'skipped',
        iconClass: 'lucide-skip-forward',
        colorClass: 'text-zinc-400',
      },
      { emoji: '✏️', label: 'modified', iconClass: 'lucide-pencil', colorClass: 'text-zinc-400' },
      { emoji: '✏', label: 'modified', iconClass: 'lucide-pencil', colorClass: 'text-zinc-400' },
      { emoji: '🗑️', label: 'deleted', iconClass: 'lucide-trash', colorClass: 'text-zinc-400' },
      { emoji: '🗑', label: 'deleted', iconClass: 'lucide-trash', colorClass: 'text-zinc-400' },
      { emoji: '🆕', label: 'new', iconClass: 'lucide-file-plus', colorClass: 'text-green-500' },
      { emoji: '⭐', label: 'important', iconClass: 'lucide-star', colorClass: 'text-amber-500' },
      { emoji: '❓', label: 'question', iconClass: 'lucide-circle', colorClass: 'text-zinc-400' },
    ])('$emoji renders $iconClass with $colorClass', ({ emoji, label, iconClass, colorClass }) => {
      const { getByRole } = renderText(emoji);
      const icon = getByRole('img', { name: label });
      expect(icon.getAttribute('class')).toContain(iconClass);
      expect(icon.getAttribute('class')).toContain(colorClass);
    });

    it('💡 renders Info, not Lightbulb (ICON_POLICY: Lightbulb = idea box)', () => {
      const { getByRole } = renderText('💡');
      expect(getByRole('img').getAttribute('class')).not.toContain('lucide-lightbulb');
    });
  });

  describe('mixed text', () => {
    it('keeps surrounding text intact around the icon', () => {
      const { container, getByRole } = renderText('前置き ✅ 後置き');
      expect(getByRole('img', { name: 'success' })).toBeInTheDocument();
      expect(container.textContent).toContain('前置き');
      expect(container.textContent).toContain('後置き');
    });

    it('handles multiple emoji in one string', () => {
      const { getAllByRole } = renderText('✅ ok と ❌ ng');
      expect(getAllByRole('img')).toHaveLength(2);
    });
  });

  describe('unknown emoji passthrough', () => {
    it('renders unmapped emoji unchanged as text', () => {
      const { container, queryByRole } = renderText('🎉 リリース 🚀');
      expect(queryByRole('img')).toBeNull();
      expect(container.textContent).toBe('🎉 リリース 🚀');
    });
  });

  describe('variation selector forms', () => {
    it.each([
      { form: '✔️', name: 'with VS16' },
      { form: '✔', name: 'bare' },
    ])('✔ $name renders the check icon', ({ form }) => {
      const { getByRole } = renderText(form);
      expect(getByRole('img').getAttribute('class')).toContain('lucide-check');
    });

    it.each([
      { form: '⚠️', name: 'with VS16' },
      { form: '⚠', name: 'bare' },
    ])('⚠ $name renders the triangle-alert icon', ({ form }) => {
      const { getByRole } = renderText(form);
      expect(getByRole('img').getAttribute('class')).toContain('lucide-triangle-alert');
    });

    it('✖️ renders the X icon and leaves no stray variation selector text', () => {
      const { container, getByRole } = renderText('a ✖️ b');
      expect(getByRole('img').getAttribute('class')).toContain('lucide-x');
      expect(container.textContent).not.toContain('️');
    });
  });

  describe('redundant status-word collapsing', () => {
    it.each([
      { input: '✅ 完了: サブタスクA', label: '完了', rest: 'サブタスクA' },
      { input: '✅ 成功： 保存処理', label: '成功', rest: '保存処理' },
      { input: '❌ 失敗: テストX', label: '失敗', rest: 'テストX' },
      { input: '⚠️ 警告: 型エラー', label: '警告', rest: '型エラー' },
      { input: '✅ Done: subtask', label: 'Done', rest: 'subtask' },
    ])('"$input" collapses to icon[$label] + "$rest"', ({ input, label, rest }) => {
      const { container, getByRole } = renderText(input);
      expect(getByRole('img', { name: label })).toBeInTheDocument();
      expect(container.textContent).not.toContain(label);
      expect(container.textContent).toContain(rest);
    });

    it.each([
      { input: '✅ 完了', label: '完了' },
      { input: '✅ 合格', label: '合格' },
      { input: '✅ OK', label: 'OK' },
      { input: '✅ Passed', label: 'Passed' },
      { input: '❌ 未実施', label: '未実施' },
      { input: '❌ NG', label: 'NG' },
      { input: '❌ Failed', label: 'Failed' },
      { input: '⚠️ 注意', label: '注意' },
      { input: '⚠️ Warning', label: 'Warning' },
    ])('bare "$input" (no colon) collapses fully', ({ input, label }) => {
      const { container, getByRole } = renderText(input);
      expect(getByRole('img', { name: label })).toBeInTheDocument();
      expect(container.textContent?.trim()).toBe('');
    });

    it('collapses "✅ 完了 サブタスク" keeping the item name', () => {
      const { container, getByRole } = renderText('✅ 完了 サブタスク');
      expect(getByRole('img', { name: '完了' })).toBeInTheDocument();
      expect(container.textContent).toContain('サブタスク');
      expect(container.textContent).not.toContain('完了');
    });

    it.each([
      { input: '✅ 完了しました', kept: '完了しました' },
      { input: '✅ Passing tests', kept: 'Passing tests' },
      { input: '❌ 失敗要因の分析', kept: '失敗要因の分析' },
    ])('does NOT collapse mid-word: "$input"', ({ input, kept }) => {
      const { container, getByRole } = renderText(input);
      // Falls back to the default label — the following word is untouched.
      expect(getByRole('img')).toBeInTheDocument();
      expect(container.textContent).toContain(kept);
    });
  });

  describe('non-string children', () => {
    it('processes strings inside arrays and passes elements through', () => {
      const { container, getByRole } = render(
        <div>{renderTextWithEmojiIcons(['✅ ', <strong key="s">bold</strong>])}</div>,
      );
      expect(getByRole('img', { name: 'success' })).toBeInTheDocument();
      expect(container.querySelector('strong')?.textContent).toBe('bold');
    });
  });
});

describe('isIconOnlyCellContent', () => {
  it.each([
    { input: '✅', expected: true },
    { input: '⚠️ ', expected: true },
    // Collapsed redundant word: renders icon-only, so it centers too.
    { input: '✅ 完了', expected: true },
    { input: '高', expected: true },
    { input: '', expected: true },
    { input: '22 / 22', expected: false },
    { input: '説明テキストの長いセルです', expected: false },
    { input: '✅ 12/12 passed', expected: false },
  ])('"$input" → $expected', ({ input, expected }) => {
    expect(isIconOnlyCellContent(input)).toBe(expected);
  });
});

describe('unwrapFullQuotes', () => {
  it('unwraps a cell whose entire content is one quoted string', () => {
    expect(unwrapFullQuotes('"notes.findMany"')).toBe('notes.findMany');
    expect(unwrapFullQuotes([' "foo" '])).toBe('foo');
  });

  it.each(['say "foo" now', '"a" and "b"', 'no quotes at all'])(
    'leaves partial/multiple quotes untouched: %j',
    (input) => {
      expect(unwrapFullQuotes(input)).toBe(input);
    },
  );
});

describe('table cell rendering via MarkdownView', () => {
  const md = [
    '| A | B | C |',
    '| --- | --- | --- |',
    '| ✅ | 長い説明のテキスト列です | "quoted" |',
  ].join('\n');

  it('centers icon-only cells, keeps prose cells left, and unwraps full-cell quotes', () => {
    const { container } = render(<MarkdownView content={md} />);
    const cells = Array.from(container.querySelectorAll('tbody td'));
    expect(cells).toHaveLength(3);
    expect(cells[0].className).toContain('text-center');
    expect(cells[1].className).not.toContain('text-center');
    expect(cells[2].textContent).toBe('quoted');
  });

  it('tints the header row and applies vertical dividers', () => {
    const { container } = render(<MarkdownView content={md} />);
    expect(container.querySelector('thead')?.className).toContain('bg-zinc-100');
    expect(container.querySelector('tr')?.className).toContain('divide-x');
  });
});
