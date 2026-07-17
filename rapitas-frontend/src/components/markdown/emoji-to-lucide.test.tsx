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
  isDashPlaceholderCell,
  isIconOnlyCellContent,
  renderTableCellContent,
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
        colorClass: 'text-sky-500',
      },
      {
        emoji: '⏭',
        label: 'skipped',
        iconClass: 'lucide-skip-forward',
        colorClass: 'text-sky-500',
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
      { input: '✅ 完了', word: '完了' },
      { input: '✅ 合格', word: '合格' },
      { input: '✅ OK', word: 'OK' },
      { input: '✅ Passed', word: 'Passed' },
      { input: '❌ 未実施', word: '未実施' },
      { input: '❌ NG', word: 'NG' },
      { input: '❌ Failed', word: 'Failed' },
      { input: '⚠️ 注意', word: '注意' },
      { input: '⚠️ Warning', word: 'Warning' },
    ])(
      'keeps icon + word when the status word IS the entire content: "$input"',
      ({ input, word }) => {
        // A lone centered icon in a verdict cell read as an outlier — when
        // nothing follows the word, it stays visible next to the icon.
        const { container, getByRole } = renderText(input);
        expect(getByRole('img')).toBeInTheDocument();
        expect(container.textContent).toContain(word);
      },
    );

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
    { input: '', expected: true },
    // Dash placeholders center like lone icons.
    { input: '—', expected: true },
    { input: '--', expected: true },
    // Icon + kept status word has visible text → left-aligned.
    { input: '✅ 完了', expected: false },
    // Text-only tiny markers (grade cells) center; 3+ chars stay left.
    { input: '高', expected: true },
    { input: '低', expected: true },
    { input: '100', expected: false },
    { input: '22 / 22', expected: false },
    { input: '説明テキストの長いセルです', expected: false },
    { input: '✅ 12/12 passed', expected: false },
  ])('"$input" → $expected', ({ input, expected }) => {
    expect(isIconOnlyCellContent(input)).toBe(expected);
  });
});

describe('dash placeholder cells', () => {
  it.each(['—', ' ― ', '--', '———'])('detects placeholder %j', (input) => {
    expect(isDashPlaceholderCell(input)).toBe(true);
  });

  it.each(['a — b', '-', '5-3', ''])('does not treat %j as a placeholder', (input) => {
    expect(isDashPlaceholderCell(input)).toBe(false);
  });

  it('renders a short muted en dash for a placeholder-only cell', () => {
    const { container } = render(<div>{renderTableCellContent('—')}</div>);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('–');
    expect(span?.className).toContain('text-zinc-500');
  });

  it('leaves dashes inside prose untouched', () => {
    const { container } = render(<div>{renderTableCellContent('before — after')}</div>);
    expect(container.textContent).toBe('before — after');
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

  it('renders verdict cells as icon + word (left) and dash placeholders as muted en dash (centered)', () => {
    const verdictMd = [
      '| 判定 | 補足 | 状態 |',
      '| --- | --- | --- |',
      '| ✅ 合格 | — | ✅ |',
    ].join('\n');
    const { container } = render(<MarkdownView content={verdictMd} />);
    const cells = Array.from(container.querySelectorAll('tbody td'));
    expect(cells).toHaveLength(3);
    // Icon + word verdict: word stays visible, cell left-aligned.
    expect(cells[0].textContent).toContain('合格');
    expect(cells[0].querySelector('svg')).not.toBeNull();
    expect(cells[0].className).not.toContain('text-center');
    // Dash placeholder: short muted en dash, centered.
    expect(cells[1].textContent).toBe('–');
    expect(cells[1].querySelector('span')?.className).toContain('text-zinc-500');
    expect(cells[1].className).toContain('text-center');
    // Lone icon still centers.
    expect(cells[2].className).toContain('text-center');
  });
});
