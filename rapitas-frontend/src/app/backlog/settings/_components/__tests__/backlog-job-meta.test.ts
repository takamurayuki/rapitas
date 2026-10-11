/**
 * backlog-job-meta.test
 *
 * The backend owns the list of periodic-job kinds and seeds a schedule row for
 * every one, so /backlog/schedules can return a kind that shipped after this
 * bundle. Measured 2026-10-11 against the live API: 11 kinds returned against 8
 * in the icon map, and the render site did `JOB_META[s.kind].icon` unguarded —
 * so the three extra kinds each threw a TypeError and took the settings page
 * down. These tests pin the guard using those real kinds.
 */

import { describe, it, expect } from 'vitest';
import { resolveJobMeta, JOB_META } from '../backlog-job-meta';

/** Kinds the live API returned that this bundle has no icon for (2026-10-11). */
const UNREGISTERED = ['gate_precision', 'knowledge_reuse', 'outage_simulation'];

describe('resolveJobMeta', () => {
  it('returns the icon and colour for every known kind', () => {
    for (const kind of Object.keys(JOB_META)) {
      const meta = resolveJobMeta(kind);
      expect(meta, kind).not.toBeNull();
      expect(meta?.icon, kind).toBeTruthy();
      expect(meta?.color, kind).toMatch(/^text-/);
    }
  });

  it('returns null instead of throwing for a kind this build does not know', () => {
    for (const kind of UNREGISTERED) {
      expect(() => resolveJobMeta(kind)).not.toThrow();
      expect(resolveJobMeta(kind), kind).toBeNull();
    }
  });

  it('returns null for inherited Object properties, not a bogus meta', () => {
    // A plain `kind in JOB_META` check would answer true for these and hand the
    // caller a function where an icon is expected.
    for (const kind of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      expect(resolveJobMeta(kind), kind).toBeNull();
    }
  });

  it('returns null for an empty kind', () => {
    expect(resolveJobMeta('')).toBeNull();
  });
});
