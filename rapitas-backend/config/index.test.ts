import { describe, test, expect } from 'bun:test';
import { resolve } from 'path';
import { getProjectRoot } from './index';

describe('getProjectRoot', () => {
  test('returns the parent directory of process.cwd()', () => {
    expect(getProjectRoot()).toBe(resolve(process.cwd(), '..'));
  });

  test('returns an absolute path', () => {
    expect(resolve(getProjectRoot())).toBe(getProjectRoot());
  });
});
