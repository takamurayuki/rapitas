/**
 * RapiAvatarDrag.test
 *
 * Picking ラピ up and putting her down somewhere else.
 *
 * What has to hold: a press that travels moves her and does NOT count as a
 * click (or every put-down would open or close the panel), a press that
 * does not travel is still a click, she is drawn as held only while held,
 * and where she was left survives a reload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { RapiAvatarDock } from '../RapiAvatarDock';
import { POSITION_STORAGE_KEY, useRapiDrag } from '../drag';

function Harness({ onClick }: { onClick: () => void }) {
  const drag = useRapiDrag();
  return <RapiAvatarDock state="running" message="うごいています" onClick={onClick} drag={drag} />;
}

const button = () => document.querySelector('[data-rapi-avatar="true"]') as HTMLElement;
const dock = () => button().parentElement as HTMLElement;

/** Press at (x, y), travel by (dx, dy), and let go — then the click the browser sends. */
const dragBy = (dx: number, dy: number, x = 1000, y = 700) => {
  fireEvent.pointerDown(button(), { button: 0, pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerMove(button(), { pointerId: 1, clientX: x + dx / 2, clientY: y + dy / 2 });
  fireEvent.pointerMove(button(), { pointerId: 1, clientX: x + dx, clientY: y + dy });
  fireEvent.pointerUp(button(), { pointerId: 1, clientX: x + dx, clientY: y + dy });
  fireEvent.click(button());
};

beforeEach(() => {
  window.localStorage.clear();
  window.innerWidth = 1400;
  window.innerHeight = 960;
});

describe('carrying her', () => {
  it('starts in the corner she always lived in', () => {
    render(<Harness onClick={vi.fn()} />);
    expect(dock().style.right).toBe('24px');
    expect(dock().style.bottom).toBe('20px');
  });

  it('follows the pointer', () => {
    render(<Harness onClick={vi.fn()} />);
    dragBy(-300, -200);
    expect(dock().style.right).toBe('324px');
    expect(dock().style.bottom).toBe('220px');
  });

  it('does not open the panel as she is put down', () => {
    const onClick = vi.fn();
    render(<Harness onClick={onClick} />);
    dragBy(-300, -200);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still opens it on a plain click afterwards', () => {
    const onClick = vi.fn();
    render(<Harness onClick={onClick} />);
    dragBy(-300, -200);
    fireEvent.click(button());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('treats a press that barely moves as a click, not a drag', () => {
    const onClick = vi.fn();
    render(<Harness onClick={onClick} />);
    dragBy(2, 1);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(dock().style.right).toBe('24px');
  });

  it('remembers where she was left', () => {
    const first = render(<Harness onClick={vi.fn()} />);
    dragBy(-300, -200);
    expect(JSON.parse(window.localStorage.getItem(POSITION_STORAGE_KEY) ?? 'null')).toEqual({
      right: 324,
      bottom: 220,
    });
    first.unmount();
    render(<Harness onClick={vi.fn()} />);
    expect(dock().style.right).toBe('324px');
  });

  it('moves her bubble to her right once she is on the left half', () => {
    render(<Harness onClick={vi.fn()} />);
    dragBy(-1100, 0);
    expect(dock().style.flexDirection).toBe('row-reverse');
    expect(dock().style.left).not.toBe('');
    expect(screen.getByText('うごいています')).toBeTruthy();
  });
});

describe('how she looks while held', () => {
  const hold = () => {
    fireEvent.pointerDown(button(), { button: 0, pointerId: 1, clientX: 1000, clientY: 700 });
    fireEvent.pointerMove(button(), { pointerId: 1, clientX: 960, clientY: 650 });
  };

  // The pinched-at-the-top pose (fingertips, a pulled-up peak, a stretch
  // and a swing) was taken out on request (2026-11-14): she is carried as
  // she is.
  it('is drawn as she is at rest: no fingertips, no pinch, no stretch', () => {
    render(<Harness onClick={vi.fn()} />);
    hold();
    expect(button().getAttribute('data-rapi-grabbed')).toBe('true');
    expect(document.querySelector('[data-rapi-pinch]')).toBeNull();
    expect(document.querySelector('[data-rapi-hang]')).toBeNull();
    expect(button().innerHTML).not.toContain('scale(0.93');
  });

  it('still lands with a squash when let go', () => {
    render(<Harness onClick={vi.fn()} />);
    dragBy(-200, -100);
    const land = document.querySelector('[data-rapi-land="true"]') as HTMLElement;
    expect(land.style.animation).toContain('rapi-land');
  });
});
