/**
 * rapi-placement.test
 *
 * Where ラピ may go once she can be dragged, and where the two things that
 * speak for her land relative to wherever she is.
 *
 * The default case is pinned to the numbers the fixed corner used before
 * dragging existed (panel `bottom: 100`, tail 34px in from the right), so
 * the change is invisible until she is moved.
 */
import { describe, it, expect } from 'vitest';
import {
  AVATAR_BOX_PX,
  DEFAULT_POSITION,
  clampPosition,
  isOnLeft,
  moveBy,
  placePanel,
} from '../rapi-placement';

const desk = { width: 1400, height: 960 };
const PANEL_W = 448;

describe('where she may be put', () => {
  it('keeps her inside the window on every side', () => {
    expect(clampPosition({ right: -500, bottom: -500 }, desk)).toEqual({ right: 8, bottom: 8 });
    const far = clampPosition({ right: 9999, bottom: 9999 }, desk);
    expect(far.right).toBe(desk.width - AVATAR_BOX_PX - 8);
    expect(far.bottom).toBe(desk.height - AVATAR_BOX_PX - 8);
  });

  it('follows the pointer: right and down shrink the distance to that corner', () => {
    expect(moveBy(DEFAULT_POSITION, 100, 50, desk)).toEqual({ right: 8, bottom: 8 });
    expect(moveBy(DEFAULT_POSITION, -300, -200, desk)).toEqual({ right: 324, bottom: 220 });
  });

  it('survives a window smaller than she is', () => {
    const tiny = clampPosition({ right: 50, bottom: 50 }, { width: 40, height: 40 });
    expect(tiny).toEqual({ right: 8, bottom: 8 });
  });
});

describe('the panel she opens', () => {
  it('sits exactly where it always did while she is in her corner', () => {
    const p = placePanel(DEFAULT_POSITION, desk, PANEL_W);
    expect(p.side).toBe('above');
    expect(p.right).toBe(24);
    expect(p.bottom).toBe(100);
    expect(p.tailOffsetPx).toBe(34);
  });

  it('opens below her when she has been carried to the top', () => {
    const top = { right: 24, bottom: desk.height - AVATAR_BOX_PX - 20 };
    const p = placePanel(top, desk, PANEL_W);
    expect(p.side).toBe('below');
    expect(p.top).toBe(20 + AVATAR_BOX_PX + 12);
    expect(p.bottom).toBeUndefined();
  });

  it('stays on screen when she is on the far left, and still points at her', () => {
    const left = { right: desk.width - AVATAR_BOX_PX - 24, bottom: 20 };
    const p = placePanel(left, desk, PANEL_W);
    const panelLeft = desk.width - p.right - p.width;
    expect(panelLeft).toBeGreaterThanOrEqual(16);
    // Her centre, measured from the panel's right edge, is where the tail is.
    const centreFromRight = left.right + AVATAR_BOX_PX / 2;
    expect(p.tailOffsetPx).toBe(centreFromRight - p.right);
  });

  it('narrows to the window on a phone-width screen', () => {
    const phone = { width: 360, height: 700 };
    const p = placePanel(DEFAULT_POSITION, phone, PANEL_W);
    expect(p.width).toBe(360 - 32);
    expect(p.right).toBeGreaterThanOrEqual(16);
  });

  it('never grows past the room it has', () => {
    const p = placePanel({ right: 24, bottom: 400 }, desk, PANEL_W);
    const room =
      p.side === 'above' ? desk.height - (p.bottom ?? 0) - 16 : desk.height - (p.top ?? 0) - 16;
    expect(p.maxHeightPx).toBeLessThanOrEqual(room);
    expect(p.maxHeightPx).toBeLessThanOrEqual(desk.height * 0.7);
  });
});

describe('which way her status bubble faces', () => {
  it('is on her left in the corner, and flips once she is on the left half', () => {
    expect(isOnLeft(DEFAULT_POSITION, desk)).toBe(false);
    expect(isOnLeft({ right: desk.width - 200, bottom: 20 }, desk)).toBe(true);
  });
});
