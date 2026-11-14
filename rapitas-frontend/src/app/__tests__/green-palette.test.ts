/**
 * green-palette.test
 *
 * Green is the app's word for "done" (task done, completed workflows, the
 * due-today bar at 100%). Tailwind's stock green is saturated enough to glare
 * on a list where many rows are done, so globals.css replaces the whole scale
 * with a calmer one (#1537). Every `green-*` utility reads this scale, which
 * is what keeps the meaning one colour across the app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf8');
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

  // Stock green-500 is chroma 0.219; at 0.13 and below it reads as green
  // without glowing. The cap holds for the whole scale, not just 500.
  it('is calmer than the stock green at every step', () => {
    for (const s of STEPS) expect(step(s)?.c ?? 1).toBeLessThanOrEqual(0.13);
  });

  // Lighter steps are backgrounds and darker ones text; a scale that does
  // not get darker step by step would turn a hover or a dark-mode label upside down.
  it('still gets darker from 50 to 950', () => {
    const ls = STEPS.map((s) => step(s)?.l ?? 0);
    expect(ls.every((l, i) => i === 0 || l < ls[i - 1])).toBe(true);
  });
});
