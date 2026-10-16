/**
 * BlockStyleSection.test
 *
 * Tests for the block style dropdown: current-type display, mousedown
 * suppression (editor keeps focus/selection), and apply callbacks.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockStyleSection } from './BlockStyleSection';
import type { BlockType } from '../block-format';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderSection(overrides: Partial<Parameters<typeof BlockStyleSection>[0]> = {}) {
  const props = {
    currentBlockType: 'p' as BlockType,
    showBlockPicker: false,
    onToggleBlockPicker: vi.fn(),
    onApplyBlockType: vi.fn(),
    ...overrides,
  };
  render(<BlockStyleSection {...props} />);
  return props;
}

describe('BlockStyleSection', () => {
  it('shows the current block type on the trigger', () => {
    renderSection({ currentBlockType: 'h2' });
    const trigger = screen.getByTitle('toolbar.blockStyle.title');
    expect(trigger.textContent).toContain('toolbar.blockStyle.h2');
  });

  it('suppresses mousedown on the trigger so the editor keeps focus', () => {
    renderSection();
    const trigger = screen.getByTitle('toolbar.blockStyle.title');
    // fireEvent returns false when preventDefault() was called.
    expect(fireEvent.mouseDown(trigger)).toBe(false);
  });

  it('suppresses mousedown on every option', () => {
    renderSection({ showBlockPicker: true });
    for (const key of ['normal', 'h1', 'h2', 'h3']) {
      // NOTE: The trigger shows the current type's label too — the menu entry
      // is always the last match in document order.
      const option = screen.getAllByText(`toolbar.blockStyle.${key}`).at(-1)!.closest('button')!;
      expect(fireEvent.mouseDown(option)).toBe(false);
    }
  });

  it('applies the chosen block type on click', () => {
    const props = renderSection({ showBlockPicker: true });
    fireEvent.click(screen.getByText('toolbar.blockStyle.h1').closest('button')!);
    expect(props.onApplyBlockType).toHaveBeenCalledWith('h1');
  });

  it('toggles the dropdown from the trigger', () => {
    const props = renderSection();
    fireEvent.click(screen.getByTitle('toolbar.blockStyle.title'));
    expect(props.onToggleBlockPicker).toHaveBeenCalled();
  });

  it('shows keyboard shortcut hints in the options', () => {
    renderSection({ showBlockPicker: true });
    expect(screen.getByText('Ctrl+Alt+0')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Alt+1')).toBeInTheDocument();
  });
});
