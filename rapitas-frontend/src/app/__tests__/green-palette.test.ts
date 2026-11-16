/**
 * green-palette.test
 *
 * Green is the app's word for "done" (task done, completed workflows, the
 * due-today bar at 100%). Tailwind's stock green glared like a highlighter;
 * a half-chroma scale (#1537) read as dull. globals.css now sets the green
 * scale to an emerald-like one — calmer than the stock green, still vivid
 * (#1539). Every `green-*` utility reads this scale, which is what keeps the
 * meaning one colour across the app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');

/** Tailwind v4's stock green chroma per step, the highlighter it replaces. */
const STOCK_CHROMA: Record<string, number> = {
  '300': 0.15,
  '400': 0.209,
  '500': 0.219,
  '600': 0.194,
  '700': 0.154,
};
const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

/** The oklch() of one step of the green scale, or null when it is not overridden. */
function step(name: string): { l: number; c: number; h: number } | null {
  const m = css.match(
    new RegExp(String.raw`--color-green-${name}:\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)`),
  );
  return m ? { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) } : null;
}

describe('the green that means done', () => {
  it('overrides every step of the scale', () => {
    expect(STEPS.filter((s) => step(s) === null)).toEqual([]);
  });

  // The steps that carry the colour (fills, icons, text): calmer than the
  // stock green, but not the dull half-chroma that was tried first.
  it('is calmer than the highlighter green, yet not dull', () => {
    for (const [s, stock] of Object.entries(STOCK_CHROMA)) {
      const c = step(s)?.c ?? 0;
      expect(c, `green-${s}`).toBeLessThan(stock);
      expect(c, `green-${s}`).toBeGreaterThanOrEqual(stock * 0.7);
    }
  });

  // Emerald sits a little towards blue of the stock green (hue ~150).
  it('leans emerald', () => {
    expect(step('500')?.h ?? 0).toBeGreaterThanOrEqual(158);
    expect(step('500')?.h ?? 0).toBeLessThanOrEqual(170);
  });

  // Lighter steps are backgrounds and darker ones text; a scale that does
  // not get darker step by step would turn a hover or a dark-mode label upside down.
  it('still gets darker from 50 to 950', () => {
    const ls = STEPS.map((s) => step(s)?.l ?? 0);
    expect(ls.every((l, i) => i === 0 || l < ls[i - 1])).toBe(true);
  });
});
