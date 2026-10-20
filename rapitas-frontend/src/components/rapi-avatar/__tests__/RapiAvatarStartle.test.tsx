/**
 * RapiAvatarStartle.test
 *
 * ラピ stretches a little when you poke her corner.
 *
 * These tests are shaped the way they are because the first version of this
 * animation never ran once and shipped green anyway. It was a SMIL
 * `<animateTransform>` with no `begin`, which means document time zero: one
 * inserted into a page that had been open for minutes was already over,
 * froze at its end value, and did nothing at all. Every test passed, because
 * every test only asked whether the element was present.
 *
 * So the mechanism is asserted here, not just the presence — a CSS animation,
 * which starts when its element does. Visual proof can only come from the
 * running app, and does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { RapiAvatar } from '../RapiAvatar';
import { RapiAvatarDock } from '../RapiAvatarDock';

/** The group carrying the stretch. */
const stretch = (el: HTMLElement) =>
  el.querySelector('[data-startle="true"]') as SVGGElement | null;

/** The keyframes the drawing carries with it. */
const keyframes = (el: HTMLElement) => el.querySelector('style')?.textContent ?? '';

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
    expect(stretch(container)).toBeNull();
  });

  it('stretches when startled', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(stretch(container)).not.toBeNull();
  });

  // The bug that shipped: a SMIL animation inserted after page load has
  // already finished and silently does nothing. A CSS animation begins with
  // the element it is attached to, which is the whole reason for the change.
  it('is driven by CSS, not by SMIL that would never run', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(stretch(container)?.style.animation).toContain('rapi-startle');
    expect(container.querySelectorAll('animateTransform[data-startle]')).toHaveLength(0);
  });

  it('carries the keyframes it refers to', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(keyframes(container)).toContain('@keyframes rapi-startle');
  });

  // A stretch, not a resize: only the y axis moves, and it does go above 1.
  it('scales the height and leaves the width alone', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    const css = keyframes(container);
    const steps = css.match(/scaleY\(([\d.]+)\)/g) ?? [];
    expect(steps.length).toBeGreaterThan(2);
    expect(css).not.toContain('scaleX');
    expect(steps.some((s) => Number(s.match(/[\d.]+/)![0]) > 1)).toBe(true);
  });

  // Anchored at her base, so she rises out of her orbit rather than growing
  // down through the front of it.
  it('grows upward from her base', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(stretch(container)?.style.transformOrigin).toContain('bottom');
  });

  it('runs the stretch once, not forever', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(stretch(container)?.style.animation).toMatch(/(^|\s)1(\s|$)/);
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
    expect(stretch(container)).toBeNull();
  });

  // Two pokes should read as two stretches. A CSS animation does not replay
  // on an element that already carries it, so the element has to be new.
  it('replaces the element on a second poke', () => {
    const { container, rerender } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    const first = stretch(container);
    rerender(<RapiAvatar state="idle" startled startleKey={2} />);
    expect(stretch(container)).not.toBe(first);
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
    expect(stretch(container)).toBeNull();
    fireEvent.click(avatarButton());
    expect(stretch(container)).not.toBeNull();
  });

  it('settles again on its own', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    fireEvent.click(avatarButton());
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(stretch(container)).toBeNull();
  });

  it('still does whatever the click was for', () => {
    const onClick = vi.fn();
    render(<RapiAvatarDock state="idle" onClick={onClick} />);
    fireEvent.click(avatarButton());
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

/**
 * The cast shadow. ラピ floats over every page, and without something on the
 * ground beneath her she reads as pasted onto the corner rather than hovering
 * above it.
 */
describe('her shadow', () => {
  const shadow = (el: HTMLElement) => el.querySelector('[data-shadow="true"]') as SVGElement | null;

  it('is cast beneath her', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    expect(shadow(container)).not.toBeNull();
  });

  // A gap is what says "floating". Touching her underside reads as resting.
  it('sits clear of her, not against her', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    const cy = Number(shadow(container)?.getAttribute('cy'));
    // The body is a circle at cy 70, r 37, so its underside is 107.
    expect(cy).toBeGreaterThan(107 + 4);
  });

  // Narrower than she is, which is what a shadow does at a distance — one as
  // wide as the object reads as the object sitting on the floor.
  it('is narrower than she is, and flat', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    const rx = Number(shadow(container)?.getAttribute('rx'));
    const ry = Number(shadow(container)?.getAttribute('ry'));
    expect(rx).toBeLessThan(37);
    expect(ry).toBeLessThan(rx / 2);
  });

  // Hard-edged black would read as a second object, not as a shadow.
  it('has soft edges', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    expect(shadow(container)?.getAttribute('fill')).toContain('url(#');
    // Lowercase selector: a CSS type selector in an HTML document is matched
    // case-insensitively against the lowercased name, so `radialGradient`
    // never matches an SVG element whose localName keeps its capital G.
    const stops = container.querySelectorAll('stop');
    expect(stops.length).toBeGreaterThan(2);
    expect(stops[stops.length - 1].getAttribute('stop-opacity')).toBe('0');
  });

  // It is on the ground, so it must not stretch with her — and the whole
  // point of the shadow is undone if it is drawn over her.
  it('is outside the stretch, and behind her', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    const sh = shadow(container)!;
    expect(container.querySelector('[data-startle="true"]')?.contains(sh)).toBe(false);
    const body = container.querySelector('circle');
    // Earlier in document order means painted first, so underneath.
    expect(sh.compareDocumentPosition(body!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // She rises when poked, so the shadow shrinks and fades — motion that
  // tracks a real state change rather than decoration.
  it('draws back when she rises', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} />);
    expect(shadow(container)?.getAttribute('style')).toContain('rapi-shadow');
    const css = container.querySelector('style')?.textContent ?? '';
    expect(css).toContain('@keyframes rapi-shadow');
  });

  it('is still when motion is reduced', () => {
    const { container } = render(<RapiAvatar state="idle" startled startleKey={1} reducedMotion />);
    expect(shadow(container)?.getAttribute('style') ?? '').not.toContain('rapi-shadow');
  });
});
