/**
 * rapi-modes.test
 *
 * Every mode has a name, in both locales.
 *
 * Reported 2026-10-21 as a console error: `rapiAvatar.mode.roadmap` did not
 * exist. `roadmap` is reachable only by typing, so nobody adding it thought
 * to add a tab label — and then the panel asked for one anyway, to say where
 * the sentence had gone. Every component test stubs next-intl and returns
 * the key itself, so not one of them could see a key that was missing.
 *
 * This one reads the shipped message files instead. That is the whole point:
 * a gate that cannot tell a real translation from an echoed key would be
 * green while the screen shows MISSING_MESSAGE.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODE_ICONS, reachableModes, type PanelMode } from './rapi-modes';

/**
 * Resolved from the package root rather than from `import.meta.url`: under
 * vitest the module URL is a transformed one, and walking up from it landed
 * on `C:\messages\ja.json` (measured).
 */
const messages = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Record<
    string,
    unknown
  >;

const modeLabels = (locale: string): Record<string, string> => {
  const all = messages(locale) as { rapiAvatar?: { mode?: Record<string, string> } };
  return all.rapiAvatar?.mode ?? {};
};

const MODES = Object.keys(MODE_ICONS) as PanelMode[];

describe.each(['ja', 'en'])('the %s labels', (locale) => {
  it.each(MODES)('name the %s mode', (mode) => {
    expect(modeLabels(locale)[mode]).toBeTruthy();
  });

  it('name every mode that can be reached, tab or not', () => {
    // The one that was missing was reachable but not a tab, which is exactly
    // the case a tab-shaped check would skip.
    const missing = reachableModes(true).filter((m) => !modeLabels(locale)[m]);
    expect(missing).toEqual([]);
  });
});

describe('the glyphs', () => {
  it('cover every mode, so no tab renders without one', () => {
    expect(reachableModes(true).every((m) => !!MODE_ICONS[m])).toBe(true);
  });

  it('give each mode its own, so two tabs are never the same picture', () => {
    const used = MODES.map((m) => MODE_ICONS[m]);
    expect(new Set(used).size).toBe(used.length);
  });
});
