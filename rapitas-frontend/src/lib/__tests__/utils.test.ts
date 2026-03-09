import { cn } from '../utils';

describe('cn', () => {
  it('joins multiple class names', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
  });

  it('filters out falsy values', () => {
    expect(cn('a', undefined, 'b', null, 'c', false)).toBe('a b c');
  });

  it('returns empty string when no arguments', () => {
    expect(cn()).toBe('');
  });

  it('returns empty string when all values are falsy', () => {
    expect(cn(undefined, null, false)).toBe('');
  });

  it('handles single class name', () => {
    expect(cn('only')).toBe('only');
  });

  it('handles empty strings by filtering them out', () => {
    expect(cn('a', '', 'b')).toBe('a b');
  });
});
