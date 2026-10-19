/**
 * pane-layering.test
 *
 * One ordering, pinned. The task detail panel's overlay covers the whole
 * viewport below the header, so a link pane stacked underneath it swallows
 * every click: pressing the pane's ✕ hit the overlay instead and closed the
 * task detail, which then moved the pane from the left edge to the right.
 */
import { describe, it, expect } from 'vitest';
import {
  LINK_PANE_Z,
  TASK_DETAIL_OVERLAY_Z,
  TASK_DETAIL_PANEL_Z,
  TERMINAL_PANEL_Z,
} from '../pane-layering';

describe('pane layering', () => {
  // The reported defect. The link pane docks to the edge the task panel is
  // NOT on precisely so both can be used at once (#1065) — being dimmed and
  // click-blocked by that panel's overlay defeats the arrangement.
  it('puts the link pane above the task detail overlay', () => {
    expect(LINK_PANE_Z).toBeGreaterThan(TASK_DETAIL_OVERLAY_Z);
  });

  // If the two ever do overlap, the task panel is the one that must stay
  // reachable.
  it('keeps the task detail panel above the link pane', () => {
    expect(TASK_DETAIL_PANEL_Z).toBeGreaterThan(LINK_PANE_Z);
  });

  // The terminal is page furniture: it should dim with the rest.
  it('leaves the terminal panel under the overlay', () => {
    expect(TERMINAL_PANEL_Z).toBeLessThan(TASK_DETAIL_OVERLAY_Z);
  });

  it('gives every layer its own level', () => {
    const levels = [TERMINAL_PANEL_Z, TASK_DETAIL_OVERLAY_Z, LINK_PANE_Z, TASK_DETAIL_PANEL_Z];
    expect(new Set(levels).size).toBe(levels.length);
  });
});
