/**
 * task-detail-link.test
 *
 * The task-detail page hides the global header unless `showHeader=true` is
 * in the query. Links that forget it drop the header and the way back.
 *
 * The note split view is the case that prompted this: it is laid out as
 * `h-[calc(100vh-4rem)]`, subtracting a header height — so when the header
 * is gone the view is both missing its chrome and 4rem short.
 */
import { describe, it, expect } from 'vitest';
import { withHeaderVisible } from '../task-detail-link';

describe('withHeaderVisible', () => {
  it('adds the flag to a bare task link', () => {
    expect(withHeaderVisible('/tasks/684')).toBe('/tasks/684?showHeader=true');
  });

  // Reported 2026-10-19: opening a linked note in split view from the task
  // detail lost the header, because `NoteLinksSection` pushed
  // `/tasks/<id>?note=<id>` while `NoteChipLink` pushed the same route
  // WITH the flag. One destination, two spellings.
  it('keeps the header when a note opens in split view', () => {
    const out = withHeaderVisible('/tasks/684?note=1739');
    expect(out).toContain('note=1739');
    expect(out).toContain('showHeader=true');
  });

  it('leaves an existing flag alone', () => {
    expect(withHeaderVisible('/tasks/684?showHeader=true&note=1')).toBe(
      '/tasks/684?showHeader=true&note=1',
    );
  });

  it('keeps every other query parameter', () => {
    const out = withHeaderVisible('/tasks/684?tab=workflow&autoExecute=true');
    expect(out).toContain('tab=workflow');
    expect(out).toContain('autoExecute=true');
    expect(out).toContain('showHeader=true');
  });

  it('does not touch a route that is not a task detail', () => {
    for (const link of ['/notes', '/tasks/new', '/tasks/684/subtasks', '/kanban?x=1']) {
      expect(withHeaderVisible(link)).toBe(link);
    }
  });

  it('is stable when applied twice', () => {
    const once = withHeaderVisible('/tasks/684?note=1');
    expect(withHeaderVisible(once)).toBe(once);
  });
});

/**
 * The helper working is not the same as the call sites using it — that gap
 * is exactly how this got through. `notification-link.test` asserted the
 * rule held while `NoteLinksSection` quietly ignored it, and its own
 * comment claimed "every other in-app route into it says so".
 *
 * So this reads the source: every navigation into the note split view has
 * to carry the header, however it is spelled.
 */
describe('every route into the note split view keeps the header', () => {
  const ENTRY_POINTS = [
    'src/app/tasks/[id]/components/NoteLinksSection.tsx',
    'src/feature/tasks/components/NoteChipLink.tsx',
  ];

  /** Navigations to `/tasks/<id>?...note=...` found in a file. */
  function splitViewNavigations(source: string): string[] {
    return [...source.matchAll(/`\/tasks\/\$\{[^`]*note=[^`]*`/g)].map((m) => m[0]);
  }

  it.each(ENTRY_POINTS)('%s', async (file) => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(file, 'utf8');
    const navigations = splitViewNavigations(source);

    expect(navigations.length, `no note split navigation found in ${file}`).toBeGreaterThan(0);
    for (const nav of navigations) {
      const line = source.split('\n').find((l) => l.includes(nav)) ?? '';
      const kept = nav.includes('showHeader=true') || line.includes('withHeaderVisible');
      expect(kept, `${file}: ${nav.trim()} drops showHeader`).toBe(true);
    }
  });
});
