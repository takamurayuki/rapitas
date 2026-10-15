/**
 * i18n eager-catalog budget tests (task 1268)
 *
 * The invariant under test is an IMPORT-GRAPH shape, not a runtime behaviour,
 * so it is asserted against the source text: a static `import` of a full
 * message catalog from a module that reaches the eager bundle puts the whole
 * catalog there, and neither a unit test of the component nor a type check can
 * see that.
 *
 * Measured 2026-10-15: `messages/ja.json` is 309.3 KB and `messages/en.json`
 * is 268.1 KB. Both were statically imported by `IntlProvider` (a provider, so
 * always eager) and by `pomodoro-tick`, which reads only the `task` namespace.
 * The largest eager chunk was 493.6 KB against a 500 KB CI budget, leaving
 * 6.4 KB — PR #915 then failed at 500.7 KB by adding one page. Every feature
 * adds strings to BOTH catalogs, so the eager chunk grew at twice the rate of
 * the feature work.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import { defaultLocale, locales } from '@/i18n/config';

const root = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const sizeKb = (rel: string) => statSync(join(root, rel)).size / 1024;

/** Modules that are reachable from the eager bundle and must not pull a catalog in. */
const EAGER_REACHABLE = [
  'src/components/providers/IntlProvider.tsx',
  'src/feature/tasks/pomodoro/pomodoro-tick.ts',
];

/** `import ... from '<any path>/messages/<locale>.json'` — the shape that costs a chunk. */
function staticCatalogImports(source: string): string[] {
  const re = /import\s+[^;]*?from\s+'[^']*messages\/([a-z]{2})\.json'/g;
  return [...source.matchAll(re)].map((m) => m[1]);
}

describe('full message catalogs stay out of the eager bundle', () => {
  it('both catalogs are large enough that the budget depends on this', () => {
    // Guards the premise: if the catalogs ever shrink to a trivial size, this
    // whole constraint can be relaxed — and the next reader should see why.
    const total = locales.reduce((sum, l) => sum + sizeKb(`messages/${l}.json`), 0);
    expect(total).toBeGreaterThan(200);
  });

  it.each(EAGER_REACHABLE)('%s statically imports no NON-DEFAULT catalog', (rel) => {
    // The default locale's catalog MAY be static: it is what the first paint
    // needs, and awaiting it would blank the app on every cold load. Every
    // other locale is dead weight in the eager chunk, because only one locale
    // is ever active.
    const nonDefault = staticCatalogImports(read(rel)).filter((l) => l !== defaultLocale);
    expect(nonDefault).toEqual([]);
  });

  it('pomodoro-tick imports no full catalog at all', () => {
    // Unlike the provider, this module needs ONE namespace, so it has no claim
    // on even the default catalog.
    expect(staticCatalogImports(read('src/feature/tasks/pomodoro/pomodoro-tick.ts'))).toEqual([]);
  });

  it('IntlProvider can still resolve every configured locale', () => {
    const source = read('src/components/providers/IntlProvider.tsx');
    // Each non-default locale needs a loader; the default one is allowed to be
    // resolved by any means, including a static fragment import.
    for (const locale of locales.filter((l) => l !== defaultLocale)) {
      expect(source).toMatch(new RegExp(`import\\([^)]*${locale}`));
    }
  });

  it('pomodoro-tick imports only the task namespace it reads', () => {
    const source = read('src/feature/tasks/pomodoro/pomodoro-tick.ts');
    expect(source).toMatch(/fragments\/[a-z]{2}\/\d+-task\.json/);
    // The task fragment must be a small fraction of the catalog it replaces.
    expect(sizeKb('messages/fragments/ja/05-task.json')).toBeLessThan(
      sizeKb('messages/ja.json') / 2,
    );
  });
});
