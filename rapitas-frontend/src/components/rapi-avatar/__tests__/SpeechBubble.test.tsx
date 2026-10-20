/**
 * SpeechBubble.test
 *
 * What makes a box read as speech rather than as a panel: a tail that points
 * at the speaker, a radius that tightens where the tail meets the body, and
 * an entrance that grows out of the tail.
 *
 * The entrance is asserted as a CSS animation, not as an attribute that
 * merely exists. The startle animation on this same avatar shipped twice as
 * SMIL with no `begin`, played zero times, and every test stayed green
 * because every test only asked whether the element was there.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SpeechBubble, SPEAK_DURATION_MS, speakOrigin } from '../SpeechBubble';

/**
 * The syntax a browser drops on the floor, matched so it can be refused.
 *
 * `transform-origin` has no four-value form — that is `background-position`
 * syntax — so a declaration like `right 34px bottom 0` is discarded whole and
 * the origin silently becomes the centre.
 */
const FOUR_VALUE = /(right|bottom)\s+[\d.]+px\s+(bottom|right)/;

const bubble = (el: HTMLElement) => el.querySelector('[data-speech-bubble="true"]') as HTMLElement;
const tails = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>('[data-bubble-tail]'));
const keyframes = (el: HTMLElement) => el.querySelector('style')?.textContent ?? '';

const below = (extra: Record<string, unknown> = {}) => (
  <SpeechBubble
    tailSide="bottom"
    tailOffsetPx={34}
    background="#FFFFFF"
    borderColor="#E5E7EB"
    {...extra}
  >
    <p>うごいています</p>
  </SpeechBubble>
);

describe('the bubble', () => {
  it('shows what it was given to say', () => {
    const { getByText } = render(below());
    expect(getByText('うごいています')).toBeTruthy();
  });

  // Without a tail it is a rounded box. The tail is the whole difference.
  it('has a tail', () => {
    const { container } = render(below());
    expect(tails(container)).toHaveLength(2);
  });

  // One triangle cannot carry a 1px edge on two sides and none on the third,
  // so the tail is the border colour behind the fill, offset by a pixel.
  it('draws the tail with a border down its sides', () => {
    const { container } = render(below());
    const [edge, fill] = tails(container);
    expect(edge.getAttribute('data-bubble-tail')).toBe('border');
    expect(edge.style.borderTopColor).toBe('rgb(229, 231, 235)');
    expect(fill.style.borderTopColor).toBe('rgb(255, 255, 255)');
  });

  it('points the tail where the caller said ラピ is', () => {
    const { container } = render(below());
    // 34px to the tail's centre, half a 9px base back from it.
    expect(tails(container)[0].style.right).toBe('25px');
  });

  it('puts a right-side tail on the right edge instead', () => {
    const { container } = render(
      <SpeechBubble tailSide="right" tailOffsetPx={20} background="#FFF" borderColor="#EEE">
        <p>よこ</p>
      </SpeechBubble>,
    );
    const [edge] = tails(container);
    expect(edge.style.bottom).toBe('11px');
    expect(edge.style.borderLeftColor).toBe('rgb(238, 238, 238)');
  });

  // Four equal corners plus a tail reads as a card with a decoration.
  it('tightens the corner the tail leaves from', () => {
    const { container } = render(below());
    const radius = bubble(container).style.borderRadius.split(' ');
    expect(radius).toHaveLength(4);
    // Bottom-right, the third value, is the tight one.
    expect(parseInt(radius[2], 10)).toBeLessThan(parseInt(radius[0], 10));
  });

  // A CSS animation, because it has to actually run: it starts with the
  // element rather than at document time zero.
  it('arrives with a CSS animation, not a static style', () => {
    const { container } = render(below());
    expect(bubble(container).style.animation).toContain('rapi-speak');
    expect(bubble(container).style.animation).toContain(`${SPEAK_DURATION_MS}ms`);
    expect(keyframes(container)).toContain('@keyframes rapi-speak');
  });

  // Growing from the centre reads as a popup; from the tail it reads as
  // coming out of her. Asserted on the value rather than the element because
  // jsdom's CSS parser accepts neither the edge-offset form nor calc() and
  // hands back an empty string either way; that it lands on the element is
  // measured in a real browser.
  it('grows out of the tail it was given', () => {
    expect(speakOrigin('bottom', 34)).toBe('calc(100% - 34px) 100%');
    expect(speakOrigin('right', 20)).toBe('100% calc(100% - 20px)');
  });

  // The bug this guards, exactly: `right 34px bottom 0` reads like it should
  // work and is `background-position` syntax. `transform-origin` has no
  // four-value form, so a browser drops the declaration and silently uses
  // the centre. It shipped that way — measured in Chromium, the origin
  // computed to `160px 111px` on a 320x222 panel. jsdom hands back an empty
  // string for both, so only the value itself can be held here.
  it('does not use the four-value syntax a browser throws away', () => {
    /** What shipped, kept here so the guard is shown to catch it. */
    const thrownAway = 'right 34px bottom 0';
    expect(thrownAway).toMatch(FOUR_VALUE);

    for (const side of ['bottom', 'right'] as const) {
      const origin = speakOrigin(side, 34);
      expect(origin).toContain('calc(');
      expect(origin).not.toMatch(FOUR_VALUE);
    }
  });

  // Not the centre, and not a bare corner — either would read as a popup.
  it('never grows from the middle', () => {
    for (const side of ['bottom', 'right'] as const) {
      const origin = speakOrigin(side, 34);
      expect(origin).not.toContain('center');
      expect(origin).toContain('34px');
    }
  });

  it('holds still when motion is reduced', () => {
    const { container } = render(below());
    const css = keyframes(container);
    expect(css).toContain('prefers-reduced-motion: reduce');
    // The override redefines the same animation, so it still runs and simply
    // does not move — rather than the component branching on a media query.
    const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
    expect(reduced).toContain('transform: none');
  });

  // Saying something new should look like a new thing being said.
  it('replays the entrance when the key changes', () => {
    const { container, rerender } = render(below({ speakKey: 1 }));
    const first = bubble(container);
    rerender(below({ speakKey: 2 }));
    expect(bubble(container)).not.toBe(first);
  });

  it('passes a label and a live region through for the reader', () => {
    const { container } = render(
      below({ role: 'dialog', 'aria-label': 'ラピ', 'aria-live': 'polite' }),
    );
    expect(bubble(container).getAttribute('role')).toBe('dialog');
    expect(bubble(container).getAttribute('aria-label')).toBe('ラピ');
    expect(bubble(container).getAttribute('aria-live')).toBe('polite');
  });

  // The tail hangs outside the body, so a clipped bubble loses it.
  it('is positioned so the tail can hang outside it', () => {
    const { container } = render(below());
    expect(bubble(container).style.position).toBe('relative');
    expect(bubble(container).style.overflow).not.toBe('hidden');
  });

  it('lets the caller place it without losing the tail', () => {
    const { container } = render(below({ style: { position: 'fixed', right: 24, bottom: 124 } }));
    expect(bubble(container).style.position).toBe('fixed');
    expect(tails(container)).toHaveLength(2);
  });
});
