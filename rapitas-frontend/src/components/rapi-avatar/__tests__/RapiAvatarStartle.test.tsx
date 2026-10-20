/**
 * RapiAvatarStartle.test
 *
 * ラピ stretches a little when you poke her corner. Small, but it is the one
 * moment the character reacts to the user rather than to the system, so it
 * has to actually happen, actually stop, and stay out of the way of anyone
 * who has asked for less motion.
 *
 * The shape of the motion is part of the design and is asserted here: a
 * vertical stretch, not a jump, and eyes that go tall rather than simply
 * bigger — "bigger" reads as a zoom, "taller" reads as startled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { RapiAvatar } from '../RapiAvatar';
import { RapiAvatarDock } from '../RapiAvatarDock';

/** The stretch, told apart from the idle animations by what it animates. */
const startleAnim = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('animateTransform')).filter(
    (a) => a.getAttribute('data-startle') === 'true',
  );

/** Every blink in the drawing. */
const blinks = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('animate')).filter(
    (a) => a.getAttribute('attributeName') === 'ry',
  );

const eyes = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('ellipse')).filter((e) => e.getAttribute('fill') === '#FFFFFF');

describe('the drawing', () => {
  it('is still until it is startled', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    expect(startleAnim(container)).toHaveLength(0);
  });

  it('jolts when startled', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(startleAnim(container)).toHaveLength(1);
  });

  it('runs the stretch once, not forever', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(startleAnim(container)[0].getAttribute('repeatCount')).toBe('1');
  });

  // A stretch, not a jump: the body changes shape where it stands.
  it('scales rather than moving', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(startleAnim(container)[0].getAttribute('type')).toBe('scale');
  });

  // Only the y axis. An x that moved too would be a resize.
  it('leaves the width alone at every step', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    const steps = String(startleAnim(container)[0].getAttribute('values')).split(';');
    expect(steps.every((s) => s.trim().split(/\s+/)[0] === '1')).toBe(true);
    expect(steps.some((s) => Number(s.trim().split(/\s+/)[1]) > 1)).toBe(true);
  });

  // Being startled is the opposite of a slow blink.
  it('stops blinking while startled', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(blinks(container)).toHaveLength(0);
  });

  // Taller, not bigger. Growing both ways reads as a zoom; the eyes should
  // stretch with the body, in the same direction, in the same frame.
  it('stretches the eyes vertically rather than enlarging them', () => {
    const calm = eyes(render(<RapiAvatar state="idle" />).container)[0];
    const calmRx = Number(calm.getAttribute('rx'));
    const calmRy = Number(calm.getAttribute('ry'));

    const tall = eyes(render(<RapiAvatar state="idle" startled startleKey={1} />).container)[0];
    const tallRx = Number(tall.getAttribute('rx'));
    const tallRy = Number(tall.getAttribute('ry'));

    expect(tallRy).toBeGreaterThan(calmRy);
    // Width may drift slightly, but nothing like the height does.
    expect(tallRy / calmRy).toBeGreaterThan(tallRx / calmRx + 0.2);
  });

  it('holds still when motion is reduced', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} reducedMotion />);
    expect(startleAnim(container)).toHaveLength(0);
  });

  // Two pokes in a row should look like two jolts, which means the element
  // has to be replaced rather than left mid-animation.
  it('restarts rather than ignoring a second poke', () => {
    const { container, rerender } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    const first = startleAnim(container)[0];
    rerender(<RapiAvatar state="idle" startled startleKey={2} />);
    expect(startleAnim(container)[0]).not.toBe(first);
  });
});

describe('the dock', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const avatarButton = () => screen.getAllByRole('button')[0];

  it('startles when ラピ is clicked', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    expect(startleAnim(container)).toHaveLength(0);
    fireEvent.click(avatarButton());
    expect(startleAnim(container)).toHaveLength(1);
  });

  it('settles again on its own', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    fireEvent.click(avatarButton());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(startleAnim(container)).toHaveLength(0);
  });

  it('still does whatever the click was for', () => {
    const onClick = vi.fn();
    render(<RapiAvatarDock state="idle" onClick={onClick} />);
    fireEvent.click(avatarButton());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
