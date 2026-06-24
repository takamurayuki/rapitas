/**
 * run-gate.test.ts
 *
 * Unit tests for the ci-gates.ts registry and run-gate.ts dispatch helpers.
 * Tests registry lookup, argument construction, and manifest integrity.
 * No subprocess is spawned — spawn correctness is verified via buildTestSuiteArgs.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'bun:test';
import { GATES, getGate } from './ci-gates';
import { buildTestSuiteArgs } from './run-gate';
import { parseGateManifest } from './gate-manifest-parser';

const SCRIPTS_DIR = import.meta.dir;
const BACKEND_DIR = resolve(SCRIPTS_DIR, '..');

// ─── getGate ─────────────────────────────────────────────────────────────────

describe('getGate', () => {
  it('returns the backend-tests gate', () => {
    const gate = getGate('backend-tests');
    expect(gate).toBeDefined();
    expect(gate?.id).toBe('backend-tests');
    expect(gate?.kind).toBe('test-suite');
  });

  it('returns the sqlite-tests gate', () => {
    const gate = getGate('sqlite-tests');
    expect(gate).toBeDefined();
    expect(gate?.id).toBe('sqlite-tests');
    expect(gate?.kind).toBe('test-suite');
  });

  it('returns undefined for an unknown gate id', () => {
    expect(getGate('does-not-exist')).toBeUndefined();
    expect(getGate('')).toBeUndefined();
  });
});

// ─── GATES registry structure ─────────────────────────────────────────────────

describe('GATES registry', () => {
  it('contains at least 2 entries', () => {
    expect(GATES.length).toBeGreaterThanOrEqual(2);
  });

  it('backend-tests gate has expected args (--coverage --isolate)', () => {
    const gate = getGate('backend-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind === 'test-suite') {
      expect(gate.args).toContain('--coverage');
      expect(gate.args).toContain('--isolate');
    }
  });

  it('backend-tests gate references ci-gate-tests.txt manifest', () => {
    const gate = getGate('backend-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind === 'test-suite') {
      expect(gate.manifest).toBe('ci-gate-tests.txt');
    }
  });

  it('sqlite-tests gate has expected args (--isolate, no --coverage)', () => {
    const gate = getGate('sqlite-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind === 'test-suite') {
      expect(gate.args).toContain('--isolate');
      expect(gate.args).not.toContain('--coverage');
    }
  });

  it('sqlite-tests gate sets RAPITAS_DB_PROVIDER=sqlite', () => {
    const gate = getGate('sqlite-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind === 'test-suite') {
      expect(gate.env?.RAPITAS_DB_PROVIDER).toBe('sqlite');
    }
  });

  it('sqlite-tests gate sets DATABASE_URL to a sqlite path', () => {
    const gate = getGate('sqlite-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind === 'test-suite') {
      const url = gate.env?.DATABASE_URL ?? '';
      expect(url.startsWith('file:')).toBe(true);
    }
  });
});

// ─── buildTestSuiteArgs ───────────────────────────────────────────────────────

describe('buildTestSuiteArgs', () => {
  it('produces correct argv for backend-tests', () => {
    const gate = getGate('backend-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind !== 'test-suite') return;
    const files = ['tests/foo.test.ts', 'tests/bar.test.ts'];
    const argv = buildTestSuiteArgs(gate, files);
    expect(argv).toEqual([
      'test',
      '--coverage',
      '--isolate',
      'tests/foo.test.ts',
      'tests/bar.test.ts',
    ]);
  });

  it('produces correct argv for sqlite-tests', () => {
    const gate = getGate('sqlite-tests');
    expect(gate?.kind).toBe('test-suite');
    if (gate?.kind !== 'test-suite') return;
    const files = ['tests/compat.test.ts'];
    const argv = buildTestSuiteArgs(gate, files);
    expect(argv).toEqual(['test', '--isolate', 'tests/compat.test.ts']);
  });

  it('handles empty files array', () => {
    const gate = getGate('backend-tests');
    if (gate?.kind !== 'test-suite') return;
    const argv = buildTestSuiteArgs(gate, []);
    expect(argv).toEqual(['test', '--coverage', '--isolate']);
  });

  it('handles gate with no args defined', () => {
    // Construct a minimal test-suite gate with no args
    const minimal = {
      kind: 'test-suite' as const,
      id: 'minimal',
      description: '',
      manifest: 'x.txt',
    };
    const argv = buildTestSuiteArgs(minimal, ['tests/a.test.ts']);
    expect(argv).toEqual(['test', 'tests/a.test.ts']);
  });
});

// ─── Manifest integrity (registry-driven) ────────────────────────────────────

const testSuiteGates = GATES.filter(
  (g): g is Extract<(typeof GATES)[number], { kind: 'test-suite' }> => g.kind === 'test-suite',
);

for (const gate of testSuiteGates) {
  describe(`manifest integrity: ${gate.id} (${gate.manifest})`, () => {
    const manifestPath = resolve(SCRIPTS_DIR, gate.manifest);
    const manifestText = readFileSync(manifestPath, 'utf-8');
    const entries = parseGateManifest(manifestText);

    it('manifest is not empty', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it('every entry ends with .test.ts or .test.mjs', () => {
      const invalid = entries.filter((f) => !f.endsWith('.test.ts') && !f.endsWith('.test.mjs'));
      expect(invalid).toEqual([]);
    });

    it('every file path listed in the manifest exists on disk', () => {
      const missing = entries.filter((f) => !existsSync(resolve(BACKEND_DIR, f)));
      expect(missing).toEqual([]);
    });
  });
}
