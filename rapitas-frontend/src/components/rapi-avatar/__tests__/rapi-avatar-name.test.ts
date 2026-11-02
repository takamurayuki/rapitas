/**
 * rapi-avatar-name.test
 *
 * The character's name lives in the message catalogue, not in the component,
 * so it has to actually be there — in every locale. A missing key renders as
 * the key itself, which no test that mocks next-intl would ever notice.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the avatar's strings live, per locale. */
const fragment = (locale: string) =>
  JSON.parse(
    readFileSync(join(process.cwd(), 'messages/fragments', locale, '07-settings.json'), 'utf8'),
  ) as { rapiAvatar?: { name?: string } };

describe('the character has a name in every locale', () => {
  it.each(['ja', 'en'])('%s defines it', (locale) => {
    const name = fragment(locale).rapiAvatar?.name;
    expect(typeof name).toBe('string');
    expect(name?.length).toBeGreaterThan(0);
  });

  it('is ラピ in Japanese', () => {
    expect(fragment('ja').rapiAvatar?.name).toBe('ラピ');
  });

  // Romanised for English, and deliberately not the product name "Rapi+" —
  // separating the two is the whole point of naming the character.
  it('is Rapi in English, without the product plus', () => {
    expect(fragment('en').rapiAvatar?.name).toBe('Rapi');
  });
});
