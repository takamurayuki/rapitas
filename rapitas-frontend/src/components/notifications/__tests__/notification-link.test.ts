/**
 * notification-link.test
 *
 * The task-detail page hides the global header unless showHeader=true is in the
 * query. Every in-app route into it says so; notification links did not, so
 * following one dropped the header with no way back.
 */
import { describe, it, expect } from 'vitest';
import { withHeaderVisible } from '../NotificationBell';

describe('withHeaderVisible', () => {
  it('keeps the header when a notification opens a task', () => {
    expect(withHeaderVisible('/tasks/684')).toBe('/tasks/684?showHeader=true');
  });

  it('preserves an existing query', () => {
    const out = withHeaderVisible('/tasks/684?tab=workflow');
    expect(out).toContain('tab=workflow');
    expect(out).toContain('showHeader=true');
  });

  it('does not duplicate the flag', () => {
    expect(withHeaderVisible('/tasks/684?showHeader=true')).toBe('/tasks/684?showHeader=true');
  });

  it('leaves other destinations untouched', () => {
    // The header is only hidden on task detail; nothing else needs the flag.
    expect(withHeaderVisible('/?panel=587')).toBe('/?panel=587');
    expect(withHeaderVisible('/tasks')).toBe('/tasks');
    expect(withHeaderVisible('/knowledge')).toBe('/knowledge');
  });

  it('leaves the new-task route untouched', () => {
    // /tasks/new is not a detail page and keeps its header already.
    expect(withHeaderVisible('/tasks/new')).toBe('/tasks/new');
  });
});
