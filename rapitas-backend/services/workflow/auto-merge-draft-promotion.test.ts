/**
 * auto-merge-draft-promotion.test
 *
 * A draft PR is a dead end for automation. Task 1099 opens one whenever the
 * local verification gate returns `unknown`, and the watcher then holds it
 * forever: `readyPullRequest` is called from exactly one place — publication
 * time, and only when the verdict was already `pass` — so nothing ever promotes
 * a draft whose CI later goes green.
 *
 * Measured 2026-10-11 on temporaid PR #1: the env-setup PR was opened as a
 * draft because e2e could not run on this host (the Playwright install hangs),
 * its CI then passed on the runner, and the PR still sat unmerged until it was
 * promoted by hand. Every generated project's PR would stop there.
 *
 * CI passing IS the verification the local gate could not produce, so a green
 * CI run is exactly the right trigger to promote. What must NOT promote: a
 * `pass` that came from the no-CI fallback (GitHub reporting CLEAN merely
 * because nothing blocking ran), because then nothing has been verified at all.
 */
import { describe, expect, it } from 'bun:test';
import { shouldPromoteDraftToReady } from './auto-merge-draft-promotion';

describe('shouldPromoteDraftToReady', () => {
  it('promotes a draft whose blocking CI checks passed', () => {
    // The measured case: temporaid PR #1, draft + green CI.
    expect(shouldPromoteDraftToReady({ draft: true, ciVerified: true })).toBe(true);
  });

  it('does not promote when the pass came from the no-CI fallback', () => {
    // `state` reaches 'pass' via GitHub's CLEAN merge state when no blocking
    // check ran. Nothing was verified, so the draft's reason still stands.
    expect(shouldPromoteDraftToReady({ draft: true, ciVerified: false })).toBe(false);
  });

  it('does not promote when the draft state could not be read', () => {
    // readIsDraft returns null on a gh failure; the watcher treats that like
    // draft===true, and promoting on a guess would defeat that fail-closed rule.
    expect(shouldPromoteDraftToReady({ draft: null, ciVerified: true })).toBe(false);
    expect(shouldPromoteDraftToReady({ draft: null, ciVerified: false })).toBe(false);
  });

  it('does nothing for a PR that is already ready', () => {
    expect(shouldPromoteDraftToReady({ draft: false, ciVerified: true })).toBe(false);
    expect(shouldPromoteDraftToReady({ draft: false, ciVerified: false })).toBe(false);
  });
});
