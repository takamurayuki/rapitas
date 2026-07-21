import { describe, test, expect } from 'bun:test';
import {
  parseOwnerRepo,
  makeOwnerRepoString,
  toOwnerRepoString,
  asOwnerRepoString,
} from './owner-repo';

describe('parseOwnerRepo', () => {
  test('parses an https URL', () => {
    expect(parseOwnerRepo('https://github.com/takamurayuki/rapitas')).toEqual({
      owner: 'takamurayuki',
      repo: 'rapitas',
    });
  });

  test('parses an https URL with .git suffix', () => {
    expect(parseOwnerRepo('https://github.com/takamurayuki/rapitas.git')).toEqual({
      owner: 'takamurayuki',
      repo: 'rapitas',
    });
  });

  test('parses an https URL with trailing slash', () => {
    expect(parseOwnerRepo('https://github.com/takamurayuki/rapitas/')).toEqual({
      owner: 'takamurayuki',
      repo: 'rapitas',
    });
  });

  test('parses an ssh URL', () => {
    expect(parseOwnerRepo('git@github.com:takamurayuki/rapitas.git')).toEqual({
      owner: 'takamurayuki',
      repo: 'rapitas',
    });
  });

  test('lowercases owner and repo', () => {
    expect(parseOwnerRepo('https://github.com/TakamuraYuki/Rapitas')).toEqual({
      owner: 'takamurayuki',
      repo: 'rapitas',
    });
  });

  test('returns null for a non-github.com host', () => {
    expect(parseOwnerRepo('https://gitlab.com/owner/repo')).toBeNull();
  });

  test('returns null for null/undefined/empty input', () => {
    expect(parseOwnerRepo(null)).toBeNull();
    expect(parseOwnerRepo(undefined)).toBeNull();
    expect(parseOwnerRepo('')).toBeNull();
  });

  test('returns null for an unparseable string', () => {
    expect(parseOwnerRepo('not a url')).toBeNull();
  });
});

describe('makeOwnerRepoString', () => {
  test('joins owner and repo with a slash', () => {
    expect(makeOwnerRepoString('takamurayuki', 'rapitas')).toBe('takamurayuki/rapitas');
  });

  test('lowercases both components', () => {
    expect(makeOwnerRepoString('TakamuraYuki', 'Rapitas')).toBe('takamurayuki/rapitas');
  });
});

describe('toOwnerRepoString', () => {
  test('joins an already-parsed OwnerRepo without re-normalizing', () => {
    const parsed = parseOwnerRepo('https://github.com/takamurayuki/rapitas');
    expect(parsed).not.toBeNull();
    expect(toOwnerRepoString(parsed!)).toBe('takamurayuki/rapitas');
  });
});

describe('asOwnerRepoString', () => {
  test('passes the string through unchanged (no validation)', () => {
    expect(asOwnerRepoString('owner/repo')).toBe('owner/repo');
  });
});
