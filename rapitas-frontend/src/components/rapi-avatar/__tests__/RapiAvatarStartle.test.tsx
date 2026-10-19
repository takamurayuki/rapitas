/**
 * RapiAvatarStartle.test
 *
 * ラピ jumps a little when you poke her corner. Small, but it is the one
 * moment the character reacts to the user rather than to the system, so it
 * has to actually happen, actually stop, and stay out of the way of anyone
 * who has asked for less motion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { RapiAvatar } from '../RapiAvatar';
import { RapiAvatarDock } from '../RapiAvatarDock';

/** The jolt, told apart from the idle animations by what it animates. */
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

  it('runs the jolt once, not forever', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(startleAnim(container)[0].getAttribute('repeatCount')).toBe('1');
  });

  // Being startled is the opposite of a slow blink.
  it('opens the eyes wider and stops blinking while startled', () => {
    const calm = render(<RapiAvatar state="idle" />);
    const calmRy = Number(eyes(calm.container)[0].getAttribute('ry'));

    const jumpy = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(Number(eyes(jumpy.container)[0].getAttribute('ry'))).toBeGreaterThan(calmRy);
    expect(blinks(jumpy.container)).toHaveLength(0);
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
