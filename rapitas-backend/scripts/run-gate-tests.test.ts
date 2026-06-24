/**
 * run-gate-tests.test.ts
 *
 * Tests for parseGateManifest (now imported from gate-manifest-parser) and
 * registry-driven manifest integrity checks covering all registered test-suite gates.
 *
 * Parser tests are retained here to act as a regression guard for the adapter
 * re-export in run-gate-tests.ts. Integrity tests are driven by GATES so that
 * new gates are automatically covered without editing this file.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'bun:test';
import { parseGateManifest } from './gate-manifest-parser';
import { GATES } from './ci-gates';

const scriptDir = import.meta.dir;
const backendRoot = resolve(scriptDir, '..');

// ─── parseGateManifest (regression guard via gate-manifest-parser) ──────────

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
    const text = '   # section header\ntests/ok.test.ts';
    expect(parseGateManifest(text)).toEqual(['tests/ok.test.ts']);
  });
});

// ─── Manifest integrity (registry-driven, covers all test-suite gates) ───────

const testSuiteGates = GATES.filter(
  (g): g is Extract<(typeof GATES)[number], { kind: 'test-suite' }> => g.kind === 'test-suite',
);

for (const gate of testSuiteGates) {
  const manifestPath = resolve(scriptDir, gate.manifest);
  const manifestText = readFileSync(manifestPath, 'utf-8');
  const entries = parseGateManifest(manifestText);

  describe(`${gate.manifest} manifest integrity`, () => {
    it('manifest is not empty', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it('every entry ends with .test.ts or .test.mjs', () => {
      const invalid = entries.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.mjs'));
      expect(invalid).toEqual([]);
    });

    it('every file path listed in the manifest exists on disk', () => {
      const missing = entries.filter((f) => !existsSync(resolve(backendRoot, f)));
      expect(missing).toEqual([]);
    });
  });
}
