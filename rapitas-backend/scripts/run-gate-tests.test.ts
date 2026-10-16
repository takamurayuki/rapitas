/**
 * run-gate-tests.test.ts
 *
 * Registry-driven manifest integrity checks covering all registered test-suite gates.
 * Integrity tests are driven by GATES so that new gates are automatically covered
 * without editing this file.
 *
 * parseGateManifest unit tests live in gate-manifest-parser.test.ts (single source of truth).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'bun:test';
import {
  parseGateManifest,
  validateManifestEntryNames,
  validateManifestFiles,
} from './gate-manifest-parser';
import { GATES } from './ci-gates';

const scriptDir = import.meta.dir;
const backendRoot = resolve(scriptDir, '..');

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
      expect(validateManifestEntryNames(entries)).toEqual([]);
    });

    it('every file path listed in the manifest exists on disk', () => {
      expect(validateManifestFiles(entries, backendRoot)).toEqual([]);
    });
  });
}
