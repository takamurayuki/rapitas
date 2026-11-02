/**
 * RapiAvatarDock.test
 *
 * The avatar is resident — it sits over every page, all the time. So its
 * scale is the dock's problem, not the drawing's: what has to hold is that
 * it reads as one of the app's controls rather than towering over them.
 *
 * The yardstick is the header, whose largest button measures 40px and whose
 * icon buttons measure 36px. `RapiAvatar`'s own default (88px) is the spec's
 * standalone size and is deliberately left alone; the dock overrides it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));

import { RapiAvatarDock } from '../RapiAvatarDock';

/** The component's standalone default, which the dock must not inherit. */
const STANDALONE_SIZE = 88;

/**
 * The largest control in the header. The sphere may reach it but not pass it;
 * the orbit ring and the badge are allowed to sit outside that, since they are
 * thin strokes rather than mass.
 */
const LARGEST_HEADER_CONTROL_PX = 40;

/** Body radius 37 in a 120 viewBox — the share of the box the sphere fills. */
const SPHERE_SHARE = (37 * 2) / 120;

const avatarSvg = (container: HTMLElement) => {
  const svg = container.querySelector('svg[viewBox="0 0 120 120"]');
  if (!svg) throw new Error('the dock rendered no avatar');
  return svg;
};

describe('the docked avatar is sized by the dock', () => {
  it('does not inherit the drawing component standalone default', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    const svg = avatarSvg(container);
    expect(Number(svg.getAttribute('width'))).toBeLessThan(STANDALONE_SIZE);
    expect(Number(svg.getAttribute('height'))).toBeLessThan(STANDALONE_SIZE);
  });

  it('is square, so the orbit is not distorted', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    const svg = avatarSvg(container);
    expect(svg.getAttribute('width')).toBe(svg.getAttribute('height'));
  });

  // The actual complaint: the sphere was 54px against a 40px header button.
  it('keeps the sphere within the scale of the app own controls', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    const box = Number(avatarSvg(container).getAttribute('width'));
    expect(box * SPHERE_SHARE).toBeLessThanOrEqual(LARGEST_HEADER_CONTROL_PX + 4);
  });

  // Shrinking it must not shrink it out of sight: below ~60px the eyes and
  // the badge stop reading at a glance.
  it('stays large enough to read at a glance', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    expect(Number(avatarSvg(container).getAttribute('width'))).toBeGreaterThanOrEqual(64);
  });
});

describe('what the dock still does', () => {
  it('speaks when there is something to say', () => {
    render(<RapiAvatarDock state="running" message="3件 実行中" />);
    expect(screen.getByText('3件 実行中')).toBeTruthy();
  });

  it('stays silent while idle', () => {
    render(<RapiAvatarDock state="idle" message="なにか" />);
    expect(screen.queryByText('なにか')).toBeNull();
  });
});
