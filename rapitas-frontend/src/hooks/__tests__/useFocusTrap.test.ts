import { renderHook } from '@testing-library/react';
import { useFocusTrap } from '../common/useFocusTrap';

describe('useFocusTrap', () => {
  function buildContainer() {
    const container = document.createElement('div');
    const first = document.createElement('button');
    first.textContent = 'first';
    const middle = document.createElement('button');
    middle.textContent = 'middle';
    const last = document.createElement('button');
    last.textContent = 'last';
    container.append(first, middle, last);
    document.body.appendChild(container);
    return { container, first, middle, last };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does nothing when inactive', () => {
    const { container, first } = buildContainer();
    const { result } = renderHook(({ active }) => useFocusTrap<HTMLDivElement>(active), {
      initialProps: { active: false },
    });
    result.current.current = container;
    expect(document.activeElement).not.toBe(first);
  });

  it('focuses the first focusable element when activated', () => {
    const { container, first } = buildContainer();
    const { result, rerender } = renderHook(({ active }) => useFocusTrap<HTMLDivElement>(active), {
      initialProps: { active: false },
    });
    result.current.current = container;
    rerender({ active: true });

    expect(document.activeElement).toBe(first);
  });

  it('wraps Tab from the last element back to the first', () => {
    const { container, first, last } = buildContainer();
    const { result, rerender } = renderHook(({ active }) => useFocusTrap<HTMLDivElement>(active), {
      initialProps: { active: false },
    });
    result.current.current = container;
    rerender({ active: true });

    last.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(first);
    expect(event.defaultPrevented).toBe(true);
  });

  it('wraps Shift+Tab from the first element back to the last', () => {
    const { container, first, last } = buildContainer();
    const { result, rerender } = renderHook(({ active }) => useFocusTrap<HTMLDivElement>(active), {
      initialProps: { active: false },
    });
    result.current.current = container;
    rerender({ active: true });

    first.focus();
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(last);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not intercept non-Tab keys', () => {
    const { container, first, middle } = buildContainer();
    const { result, rerender } = renderHook(({ active }) => useFocusTrap<HTMLDivElement>(active), {
      initialProps: { active: false },
    });
    result.current.current = container;
    rerender({ active: true });

    middle.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    container.dispatchEvent(event);

    expect(document.activeElement).toBe(middle);
    expect(first).not.toBe(document.activeElement);
  });

  it('restores focus to the previously focused element on cleanup', () => {
    const { container } = buildContainer();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    const { result, rerender } = renderHook(({ active }) => useFocusTrap<HTMLDivElement>(active), {
      initialProps: { active: false },
    });
    result.current.current = container;
    rerender({ active: true });
    rerender({ active: false });

    expect(document.activeElement).toBe(outside);
  });
});
