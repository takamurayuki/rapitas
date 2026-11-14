/**
 * LinkViewHost.lazy.test
 *
 * Guards the initial-load bundle: LinkViewHost is mounted in the root layout,
 * so anything it imports statically ships on every page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'LinkViewHost.tsx'), 'utf8');

describe('LinkViewHost imports', () => {
  // These only render on /browser or while the pane is open. Importing them
  // statically pushed an eager chunk past the 500 KB budget (#1525).
  it.each(['BrowserScreen', 'LinkBandBar', 'LinkFavourites', 'LinkViewPane'])(
    'loads %s on demand, not at startup',
    (name) => {
      // String.raw keeps the backslashes: in a plain template literal `\s` is
      // just "s" and `\b` a backspace, and the check could never fail.
      const staticImport = new RegExp(String.raw`^import\s[^;]*\b${name}\b[^;]*from\s`, 'm');
      expect(source).not.toMatch(staticImport);
      expect(source).toMatch(new RegExp(String.raw`import\(['"][^'"]*/${name}['"]\)`));
    },
  );
});
