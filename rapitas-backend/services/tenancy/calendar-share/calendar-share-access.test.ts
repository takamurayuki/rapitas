/**
 * calendar-share-access unit
 *
 * This is the one decision that stands between two accounts' calendars, so
 * every branch is pinned here rather than inferred from the route.
 *
 * The rule that needs the most protection is the no-session one. This app
 * serves unauthenticated requests UNSCOPED by design — guest-first,
 * fail-open — which means "no workspace" is the default state, not an
 * anomaly. A share endpoint that inherited that default would hand a
 * sessionless caller somebody's calendar, so this module fails CLOSED and
 * the test below is what keeps it that way.
 */
import { describe, it, expect } from 'bun:test';
import { decideCalendarShareAccess } from './calendar-share-access';

describe('decideCalendarShareAccess', () => {
  it('allows a viewer holding a grant', () => {
    expect(
      decideCalendarShareAccess({ viewerWorkspaceId: 2, ownerWorkspaceId: 1, hasGrant: true }),
    ).toEqual({ allowed: true });
  });

  it('refuses a viewer with no grant', () => {
    expect(
      decideCalendarShareAccess({ viewerWorkspaceId: 2, ownerWorkspaceId: 1, hasGrant: false }),
    ).toEqual({ allowed: false, reason: 'not_shared' });
  });

  it('refuses when no session established a workspace', () => {
    // Fails closed against this app's unscoped default. A grant lookup for a
    // null viewer cannot match anything, but relying on that would make the
    // guarantee an accident of the query rather than a stated rule.
    expect(
      decideCalendarShareAccess({ viewerWorkspaceId: null, ownerWorkspaceId: 1, hasGrant: false }),
    ).toEqual({ allowed: false, reason: 'no_session' });
  });

  it('refuses a sessionless caller even if a grant was somehow found', () => {
    // Guards the order of the checks: no amount of grant evidence may stand
    // in for an identity.
    expect(
      decideCalendarShareAccess({ viewerWorkspaceId: null, ownerWorkspaceId: 1, hasGrant: true }),
    ).toEqual({ allowed: false, reason: 'no_session' });
  });

  it('lets a workspace read its own calendar with no grant', () => {
    expect(
      decideCalendarShareAccess({ viewerWorkspaceId: 7, ownerWorkspaceId: 7, hasGrant: false }),
    ).toEqual({ allowed: true });
  });

  it('does not treat a grant as mutual', () => {
    // A row means owner is visible TO viewer. Asking the other way round with
    // that same row present must still be refused — the caller is expected to
    // look the grant up in the direction it is reading, and if a future
    // caller gets that backwards this is the line that fails.
    const reversed = decideCalendarShareAccess({
      viewerWorkspaceId: 1,
      ownerWorkspaceId: 2,
      hasGrant: false,
    });
    expect(reversed).toEqual({ allowed: false, reason: 'not_shared' });
  });

  it('refuses an owner id that is not a usable workspace id', () => {
    // Number(params.ownerWorkspaceId) on a junk path segment yields NaN, and
    // NaN === NaN is false, so the self-read branch cannot swallow it — but a
    // stated refusal beats a lucky one.
    for (const ownerWorkspaceId of [Number.NaN, 0, -1, 1.5]) {
      expect(
        decideCalendarShareAccess({ viewerWorkspaceId: 2, ownerWorkspaceId, hasGrant: true }),
      ).toEqual({ allowed: false, reason: 'invalid_owner' });
    }
  });
});
