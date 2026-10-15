/**
 * FontPickerSection.test
 *
 * Tests for the toolbar font/size pickers: mousedown suppression (so the
 * editor keeps focus and selection), font application callbacks, and the
 * font-size input validation/commit behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FontPickerSection } from './FontPickerSection';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderSection(overrides: Partial<Parameters<typeof FontPickerSection>[0]> = {}) {
  const props = {
    currentFont: 'inherit',
    currentFontSize: '16',
    showFontPicker: false,
    showFontSizePicker: false,
    setCurrentFont: vi.fn(),
    setCurrentFontSize: vi.fn(),
    setShowFontPicker: vi.fn(),
    setShowFontSizePicker: vi.fn(),
    onApplyFont: vi.fn(),
    onApplyFontSize: vi.fn(),
    ...overrides,
  };
  render(<FontPickerSection {...props} />);
  return props;
}

const sizeInput = () => screen.getByTitle('toolbar.fontPicker.fontSizeTitle') as HTMLInputElement;

describe('FontPickerSection — font dropdown', () => {
  it('suppresses mousedown on font options so the editor keeps its selection', () => {
    renderSection({ showFontPicker: true });
    const option = screen.getByText('editorColors.font.georgia').closest('button')!;
    // fireEvent returns false when preventDefault() was called.
    expect(fireEvent.mouseDown(option)).toBe(false);
  });

  it('suppresses mousedown on the picker trigger button', () => {
    renderSection();
    const trigger = screen.getByTitle('toolbar.fontPicker.fontTitle');
    expect(fireEvent.mouseDown(trigger)).toBe(false);
  });

  it('applies the chosen font and closes the picker on click', () => {
    const props = renderSection({ showFontPicker: true });
    fireEvent.click(screen.getByText('editorColors.font.georgia').closest('button')!);

    expect(props.setCurrentFont).toHaveBeenCalledWith('Georgia, serif');
    expect(props.onApplyFont).toHaveBeenCalledWith('Georgia, serif');
    expect(props.setShowFontPicker).toHaveBeenCalledWith(false);
  });
});

describe('FontPickerSection — font size input', () => {
  it('accepts a leading digit below 8 while typing (e.g. the "1" of "16")', () => {
    const props = renderSection();
    fireEvent.change(sizeInput(), { target: { value: '1' } });
    expect(props.setCurrentFontSize).toHaveBeenCalledWith('1');
  });

  it('rejects values above 72 while typing', () => {
    const props = renderSection();
    fireEvent.change(sizeInput(), { target: { value: '99' } });
    expect(props.setCurrentFontSize).not.toHaveBeenCalled();
  });

  it('clamps sizes below the minimum on blur', () => {
    const props = renderSection({ currentFontSize: '7' });
    fireEvent.blur(sizeInput());
    expect(props.setCurrentFontSize).toHaveBeenCalledWith('8');
    expect(props.onApplyFontSize).toHaveBeenCalledWith('8px');
  });

  it('falls back to 16 when committing an empty value', () => {
    const props = renderSection({ currentFontSize: '' });
    fireEvent.blur(sizeInput());
    expect(props.setCurrentFontSize).toHaveBeenCalledWith('16');
    expect(props.onApplyFontSize).toHaveBeenCalledWith('16px');
  });

  it('applies a valid size on Enter', () => {
    const props = renderSection({ currentFontSize: '40' });
    fireEvent.keyDown(sizeInput(), { key: 'Enter' });
    expect(props.onApplyFontSize).toHaveBeenCalledWith('40px');
  });
});
