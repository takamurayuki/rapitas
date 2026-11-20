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

describe('what the bubble says while agents run', () => {
  const lines = [
    { key: '1', taskId: 1509, title: '期限順で並べ替える', phase: '検証中' },
    { key: '2', taskId: 1510, title: '通知の文言を直す', phase: '実装中' },
  ];

  it('names each task and the phase it is in', () => {
    render(<RapiAvatarDock state="running" message="2件実行中" lines={lines} />);
    expect(screen.getByText('期限順で並べ替える')).toBeTruthy();
    expect(screen.getByText('検証中')).toBeTruthy();
    expect(screen.getByText('通知の文言を直す')).toBeTruthy();
    expect(screen.getByText('実装中')).toBeTruthy();
  });

  it('opens the task from its line, with the header kept', () => {
    render(<RapiAvatarDock state="running" message="2件" lines={lines} />);
    const link = screen.getByText('期限順で並べ替える').closest('a');
    expect(link?.getAttribute('href')).toBe('/tasks/1509?showHeader=true');
  });

  it('says how many more there are past the shown ones', () => {
    render(<RapiAvatarDock state="running" message="5件" lines={lines} more="ほか3件" />);
    expect(screen.getByText('ほか3件')).toBeTruthy();
  });

  it('reads the lines out to a screen reader too', () => {
    render(<RapiAvatarDock state="running" message="2件" lines={lines} />);
    const button = screen.getByRole('button');
    expect(button.getAttribute('aria-label')).toContain('期限順で並べ替える');
  });
});
