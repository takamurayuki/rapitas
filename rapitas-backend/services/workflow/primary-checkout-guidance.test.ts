/**
 * primary-checkout-guidance test
 *
 * Confirms the shared guidance names the forbidden `git -C <primary>` form and the cwd alternative.
 */
import { describe, test, expect } from 'bun:test';
import { PRIMARY_CHECKOUT_GUIDANCE } from './primary-checkout-guidance';

describe('PRIMARY_CHECKOUT_GUIDANCE', () => {
  test.each(['ja', 'en'] as const)('%s names the forbidden form and the alternative', (lang) => {
    const text = PRIMARY_CHECKOUT_GUIDANCE[lang];
    expect(text).toContain('git -C');
    expect(text).toContain('git branch --show-current');
    expect(text).toContain('origin/');
    expect(text).not.toContain('C:/Projects');
  });
});
