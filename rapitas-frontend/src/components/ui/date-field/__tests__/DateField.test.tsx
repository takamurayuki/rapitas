/**
 * DateField.test
 *
 * Covers the behaviour the native input could not give us: a yyyy/mm/dd display
 * that still emits the `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` values every call site
 * already handles, so the 15 replaced call sites stay drop-in.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DateField from '../DateField';

beforeAll(() => {
  // jsdom has no showPicker; the component must not crash without it.
  if (!('showPicker' in HTMLInputElement.prototype)) {
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  }
});

describe('DateField', () => {
  it('値を yyyy/mm/dd で表示する', () => {
    render(<DateField value="2026-10-07" onChange={() => {}} aria-label="期限" />);
    expect(screen.getByRole('textbox', { name: '期限' })).toHaveValue('2026/10/07');
  });

  it('withTime では yyyy/mm/dd HH:mm で表示する', () => {
    render(<DateField value="2026-10-07T13:45" onChange={() => {}} withTime aria-label="期限" />);
    expect(screen.getByRole('textbox', { name: '期限' })).toHaveValue('2026/10/07 13:45');
  });

  // The load-bearing contract: callers keep receiving native-input values.
  it('入力された yyyy/mm/dd を YYYY-MM-DD として通知する', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="期限" />);
    fireEvent.change(screen.getByRole('textbox', { name: '期限' }), {
      target: { value: '2026/10/07' },
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-07');
  });

  it('withTime では YYYY-MM-DDTHH:mm として通知する', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} withTime aria-label="期限" />);
    fireEvent.change(screen.getByRole('textbox', { name: '期限' }), {
      target: { value: '2026/10/07 13:45' },
    });
    expect(onChange).toHaveBeenCalledWith('2026-10-07T13:45');
  });

  it('入力途中の不完全な文字列では通知しない', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="期限" />);
    fireEvent.change(screen.getByRole('textbox', { name: '期限' }), {
      target: { value: '2026/1' },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('存在しない日付では通知しない', () => {
    const onChange = vi.fn();
    render(<DateField value="" onChange={onChange} aria-label="期限" />);
    fireEvent.change(screen.getByRole('textbox', { name: '期限' }), {
      target: { value: '2026/02/30' },
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  // A rejected entry must not stay on screen looking accepted.
  it('不正な入力はフォーカスを外すと確定値に戻る', () => {
    render(<DateField value="2026-10-07" onChange={() => {}} aria-label="期限" />);
    const input = screen.getByRole('textbox', { name: '期限' });
    fireEvent.change(input, { target: { value: 'でたらめ' } });
    expect(input).toHaveValue('でたらめ');
    fireEvent.blur(input);
    expect(input).toHaveValue('2026/10/07');
  });

  it('空にすると空文字を通知する(値のクリア)', () => {
    const onChange = vi.fn();
    render(<DateField value="2026-10-07" onChange={onChange} aria-label="期限" />);
    fireEvent.change(screen.getByRole('textbox', { name: '期限' }), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('onBlur が呼ばれる(blur で保存する呼び出し元のため)', () => {
    const onBlur = vi.fn();
    render(<DateField value="2026-10-07" onChange={() => {}} onBlur={onBlur} aria-label="期限" />);
    fireEvent.blur(screen.getByRole('textbox', { name: '期限' }));
    expect(onBlur).toHaveBeenCalled();
  });

  it('カレンダーボタンがネイティブピッカーを開く', () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      value: showPicker,
      writable: true,
      configurable: true,
    });
    render(<DateField value="2026-10-07" onChange={() => {}} aria-label="期限" />);
    fireEvent.click(screen.getByRole('button', { name: '期限' }));
    expect(showPicker).toHaveBeenCalled();
  });

  it('ピッカーで選んだ値をそのまま通知する', () => {
    const onChange = vi.fn();
    const { container } = render(<DateField value="" onChange={onChange} aria-label="期限" />);
    const picker = container.querySelector('input[type="date"]');
    expect(picker).not.toBeNull();
    fireEvent.change(picker!, { target: { value: '2026-12-24' } });
    expect(onChange).toHaveBeenCalledWith('2026-12-24');
  });

  it('min / max を隠しピッカーへ渡す', () => {
    const { container } = render(
      <DateField
        value=""
        onChange={() => {}}
        min="2026-01-01"
        max="2026-12-31"
        aria-label="期限"
      />,
    );
    const picker = container.querySelector('input[type="date"]');
    expect(picker).toHaveAttribute('min', '2026-01-01');
    expect(picker).toHaveAttribute('max', '2026-12-31');
  });

  it('外から値が変わると表示も追従する', () => {
    const { rerender } = render(
      <DateField value="2026-10-07" onChange={() => {}} aria-label="期限" />,
    );
    rerender(<DateField value="2026-11-01" onChange={() => {}} aria-label="期限" />);
    expect(screen.getByRole('textbox', { name: '期限' })).toHaveValue('2026/11/01');
  });
});
