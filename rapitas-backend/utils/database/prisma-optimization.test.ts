/**
 * prisma-optimization.test
 *
 * Verifies that QueryOptimizers.searchTasks produces mode-safe WHERE clauses:
 * - SQLite (RAPITAS_DB_PROVIDER=sqlite): no `mode` key
 * - PostgreSQL (default): `mode: 'insensitive'` present
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { QueryOptimizers } from './prisma-optimization';

type StringFilter = { contains: string; mode?: string };

function getOrFilters(searchTerm: string) {
  const config = QueryOptimizers.searchTasks(searchTerm);
  const and = config.where.AND as [unknown, { OR: unknown[] }];
  return and[1].OR as Array<
    | { title: StringFilter }
    | { description: StringFilter }
    | { labels: { some: { label: { name: StringFilter } } } }
  >;
}

describe('QueryOptimizers.searchTasks — mode guard', () => {
  let savedProvider: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedUrl = process.env.DATABASE_URL;
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  it('postgresql: title/description/label filters all contain mode:insensitive', () => {
    // default (no env vars) = postgresql
    const [titleFilter, descFilter, labelFilter] = getOrFilters('hello');
    expect((titleFilter as { title: StringFilter }).title.mode).toBe('insensitive');
    expect((descFilter as { description: StringFilter }).description.mode).toBe('insensitive');
    expect(
      (labelFilter as { labels: { some: { label: { name: StringFilter } } } }).labels.some.label
        .name.mode,
    ).toBe('insensitive');
  });

  it('sqlite: title/description/label filters have no mode key', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    const [titleFilter, descFilter, labelFilter] = getOrFilters('hello');
    expect((titleFilter as { title: StringFilter }).title).not.toHaveProperty('mode');
    expect((descFilter as { description: StringFilter }).description).not.toHaveProperty('mode');
    expect(
      (labelFilter as { labels: { some: { label: { name: StringFilter } } } }).labels.some.label
        .name,
    ).not.toHaveProperty('mode');
  });

  it('contains the search term in all filters', () => {
    const [titleFilter, descFilter] = getOrFilters('myterm');
    expect((titleFilter as { title: StringFilter }).title.contains).toBe('myterm');
    expect((descFilter as { description: StringFilter }).description.contains).toBe('myterm');
  });
});
