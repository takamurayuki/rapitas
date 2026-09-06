/**
 * idea-box-search.test
 *
 * The search fragment must be absent for blank input, match title OR
 * content, and stay AND-wrapped so it composes with the priority OR.
 */
import { describe, test, expect } from 'bun:test';
import { buildIdeaSearchFilter } from './idea-box-search';

describe('buildIdeaSearchFilter', () => {
  test('returns an empty fragment for undefined or whitespace', () => {
    expect(buildIdeaSearchFilter(undefined)).toEqual({});
    expect(buildIdeaSearchFilter('   ')).toEqual({});
  });

  test('matches the trimmed term against title OR content inside AND', () => {
    const fragment = buildIdeaSearchFilter('  ポモドーロ ');
    expect(fragment.AND).toHaveLength(1);
    const [clause] = fragment.AND!;
    expect(clause.OR.map((o) => Object.keys(o)[0])).toEqual(['title', 'content']);
    expect(clause.OR[0].title.contains).toBe('ポモドーロ');
    expect(clause.OR[1].content.contains).toBe('ポモドーロ');
  });
});
