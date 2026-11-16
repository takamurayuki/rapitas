/**
 * shortcut-labels.test
 *
 * Every default shortcut id doubles as a message key under `shortcuts.labels`,
 * so a new id without a label shows the raw key on the settings page.
 */
import { DEFAULT_SHORTCUTS } from '../shortcut-store';
import ja from '../../../messages/fragments/ja/08-shortcuts.json';
import en from '../../../messages/fragments/en/08-shortcuts.json';

describe('shortcut labels', () => {
  it.each([
    ['ja', ja.shortcuts.labels as Record<string, string>],
    ['en', en.shortcuts.labels as Record<string, string>],
  ])('has a %s label for every default shortcut', (_locale, labels) => {
    const missing = DEFAULT_SHORTCUTS.map((s) => s.id).filter((id) => !labels[id]);
    expect(missing).toEqual([]);
  });
});
