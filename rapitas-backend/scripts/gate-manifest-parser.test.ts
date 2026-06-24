/**
 * gate-manifest-parser.test.ts
 *
 * Unit tests for gate-manifest-parser.ts.
 * Covers parseGateManifest (comment/blank removal, trim, edge cases),
 * validateManifestEntryNames (naming convention enforcement),
 * and validateManifestFiles (drift detection pure function).
 */

import { existsSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'bun:test';
import {
  parseGateManifest,
  validateManifestEntryNames,
  validateManifestFiles,
} from './gate-manifest-parser';

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

  it('treats a whitespace-prefixed # line as a comment', () => {
    const text = '   # section header\ntests/ok.test.ts';
    expect(parseGateManifest(text)).toEqual(['tests/ok.test.ts']);
  });
});

describe('validateManifestEntryNames', () => {
  it('returns empty array for .test.ts entries', () => {
    expect(validateManifestEntryNames(['tests/foo.test.ts', 'tests/bar.test.ts'])).toEqual([]);
  });

  it('returns empty array for .integration.test.ts entries (.test.ts suffix)', () => {
    expect(
      validateManifestEntryNames([
        'tests/foo.integration.test.ts',
        'tests/bar.integration.test.ts',
      ]),
    ).toEqual([]);
  });

  it('returns empty array for .test.mjs entries', () => {
    expect(validateManifestEntryNames(['eslint-rules/no-raw-prisma-insensitive.test.mjs'])).toEqual(
      [],
    );
  });

  it('returns invalid entry for a plain .ts file', () => {
    expect(validateManifestEntryNames(['src/foo.ts', 'tests/bar.test.ts'])).toEqual(['src/foo.ts']);
  });

  it('returns invalid entry for a .spec.ts file', () => {
    expect(validateManifestEntryNames(['tests/foo.spec.ts'])).toEqual(['tests/foo.spec.ts']);
  });

  it('returns invalid entry for a .test.js file', () => {
    expect(validateManifestEntryNames(['tests/foo.test.js'])).toEqual(['tests/foo.test.js']);
  });

  it('returns only invalid entries from a mixed list', () => {
    const entries = [
      'tests/valid.test.ts',
      'src/invalid.ts',
      'eslint/rule.test.mjs',
      'src/spec.spec.ts',
    ];
    expect(validateManifestEntryNames(entries)).toEqual(['src/invalid.ts', 'src/spec.spec.ts']);
  });

  it('returns empty array for an empty input', () => {
    expect(validateManifestEntryNames([])).toEqual([]);
  });
});

describe('validateManifestFiles', () => {
  const SCRIPTS_DIR = import.meta.dir;
  const BACKEND_DIR = resolve(SCRIPTS_DIR, '..');

  it('returns empty array when all files exist', () => {
    // Use the manifest files themselves as known-to-exist targets
    const knownFiles = [
      'scripts/gate-manifest-parser.ts',
      'scripts/ci-gates.ts',
      'scripts/run-gate.ts',
    ];
    expect(validateManifestFiles(knownFiles, BACKEND_DIR)).toEqual([]);
  });

  it('returns paths that do not exist on disk', () => {
    const files = ['scripts/gate-manifest-parser.ts', 'scripts/does-not-exist.ts'];
    const missing = validateManifestFiles(files, BACKEND_DIR);
    expect(missing).toEqual(['scripts/does-not-exist.ts']);
  });

  it('returns all paths when none exist', () => {
    const files = ['non/existent/a.ts', 'non/existent/b.ts'];
    expect(validateManifestFiles(files, BACKEND_DIR)).toEqual(files);
  });

  it('returns empty array for an empty file list', () => {
    expect(validateManifestFiles([], BACKEND_DIR)).toEqual([]);
  });

  it('resolves paths relative to rootDir', () => {
    // Verify that a path that exists only when resolved from BACKEND_DIR is found
    const relativeToBackend = 'scripts/ci-gate-tests.txt';
    expect(existsSync(resolve(BACKEND_DIR, relativeToBackend))).toBe(true);
    expect(validateManifestFiles([relativeToBackend], BACKEND_DIR)).toEqual([]);
  });
});
