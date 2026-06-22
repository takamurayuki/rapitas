/**
 * run-gate-tests.test.ts
 *
 * Unit tests for the parseGateManifest pure function exported from run-gate-tests.ts.
 * Covers: normal paths, comment/blank-line removal, all-comment empty result, trim.
 */

import { describe, expect, it } from 'bun:test';
import { parseGateManifest } from './run-gate-tests';

describe('parseGateManifest', () => {
  it('returns file paths from a normal multi-line manifest', () => {
    const text = [
      '# CI gate suite manifest',
      'tests/foo.test.ts',
      'tests/bar.test.ts',
      'services/baz.test.ts',
    ].join('\n');

    expect(parseGateManifest(text)).toEqual([
      'tests/foo.test.ts',
      'tests/bar.test.ts',
      'services/baz.test.ts',
    ]);
  });

  it('removes blank lines', () => {
    const text = '\ntests/foo.test.ts\n\ntests/bar.test.ts\n';
    expect(parseGateManifest(text)).toEqual(['tests/foo.test.ts', 'tests/bar.test.ts']);
  });

  it('removes comment lines starting with #', () => {
    const text = [
      '# This is a comment',
      'tests/real.test.ts',
      '  # indented comment',
      'tests/another.test.ts',
    ].join('\n');

    expect(parseGateManifest(text)).toEqual(['tests/real.test.ts', 'tests/another.test.ts']);
  });

  it('returns empty array when all lines are comments or blank', () => {
    const text = ['# comment 1', '', '# comment 2', '   ', '# comment 3'].join('\n');
    expect(parseGateManifest(text)).toEqual([]);
  });

  it('returns empty array for an empty string', () => {
    expect(parseGateManifest('')).toEqual([]);
  });

  it('trims leading and trailing whitespace from path lines', () => {
    const text = '  tests/foo.test.ts  \n\ttests/bar.test.ts\t';
    expect(parseGateManifest(text)).toEqual(['tests/foo.test.ts', 'tests/bar.test.ts']);
  });

  it('handles a manifest with only one path', () => {
    expect(parseGateManifest('tests/single.test.ts')).toEqual(['tests/single.test.ts']);
  });

  it('treats a line that starts with # after trim as a comment', () => {
    // A line that is purely whitespace + # is still a comment
    const text = '   # section header\ntests/ok.test.ts';
    expect(parseGateManifest(text)).toEqual(['tests/ok.test.ts']);
  });
});
