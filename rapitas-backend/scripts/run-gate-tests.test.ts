/**
 * run-gate-tests.test.ts
 *
 * Unit tests for the parseGateManifest pure function exported from run-gate-tests.ts.
 * Covers: normal paths, comment/blank-line removal, all-comment empty result, trim.
 * Also validates that ci-gate-tests.txt manifest entries actually exist on disk.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
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

describe('ci-gate-tests.txt manifest integrity', () => {
  // NOTE: These tests catch drift between the manifest and the filesystem.
  // If a test file is renamed/deleted, the corresponding manifest entry must be updated first.
  const scriptDir = import.meta.dir;
  const manifestPath = resolve(scriptDir, 'ci-gate-tests.txt');
  const backendRoot = resolve(scriptDir, '..');

  const manifestText = readFileSync(manifestPath, 'utf-8');
  const entries = parseGateManifest(manifestText);

  it('manifest is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('every entry ends with .test.ts or .integration.test.ts', () => {
    const invalid = entries.filter((f) => !f.endsWith('.test.ts'));
    expect(invalid).toEqual([]);
  });

  it('every file path listed in the manifest exists on disk', () => {
    const missing = entries.filter((f) => !existsSync(resolve(backendRoot, f)));
    expect(missing).toEqual([]);
  });
});
