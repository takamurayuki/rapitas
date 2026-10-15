/**
 * run-gate.test.ts
 *
 * Unit tests for the ci-gates.ts registry and run-gate.ts dispatch helpers.
 * Tests registry lookup, argument construction, manifest integrity, and
 * the --files trigger filtering functions (loadTriggers, matchesTrigger, selectTests).
 * No subprocess is spawned — spawn correctness is verified via buildTestSuiteArgs.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'bun:test';
import { GATES, getGate } from './ci-gates';
import { buildTestSuiteArgs, loadTriggers, matchesTrigger, selectTests } from './run-gate';
import {
  parseGateManifest,
  validateManifestEntryNames,
  validateManifestFiles,
} from './gate-manifest-parser';
import { parseFilesArg } from './parse-files-arg';

const SCRIPTS_DIR = import.meta.dir;
const BACKEND_DIR = resolve(SCRIPTS_DIR, '..');

// ─── getGate ─────────────────────────────────────────────────────────────────

describe('getGate', () => {
  it.each(['backend-tests', 'sqlite-tests'])('returns the %s gate', (id) => {
    const gate = getGate(id);
    expect(gate).toBeDefined();
    expect(gate?.id).toBe(id);
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

  // eslint-disable-next-line local/prefer-test-each-for-similar -- each test asserts a different gate field (args / env.RAPITAS_DB_PROVIDER / env.DATABASE_URL) with a distinct assertion shape, not a parameterizable input/output pair
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
      expect(validateManifestEntryNames(entries)).toEqual([]);
    });

    it('every file path listed in the manifest exists on disk', () => {
      expect(validateManifestFiles(entries, BACKEND_DIR)).toEqual([]);
    });
  });
}

// ─── parseFilesArg ────────────────────────────────────────────────────────────

describe('parseFilesArg', () => {
  it.each([
    {
      label: 'returns null when --files flag is absent (no flag)',
      argv: ['bun', 'script.ts'],
      expected: null,
    },
    { label: 'returns null when --files flag is absent (empty argv)', argv: [], expected: null },
    {
      label: 'returns [] for --files= with empty value',
      argv: ['bun', 'script.ts', '--files='],
      expected: [],
    },
    {
      label: 'returns a single file from --files=a.ts',
      argv: ['bun', 'script.ts', '--files=a.ts'],
      expected: ['a.ts'],
    },
    {
      label: 'returns multiple files from comma-separated --files=a.ts,b.ts',
      argv: ['bun', 'script.ts', '--files=a.ts,b.ts'],
      expected: ['a.ts', 'b.ts'],
    },
  ])('$label', ({ argv, expected }) => {
    expect(parseFilesArg(argv)).toEqual(expected);
  });

  it('trims whitespace around comma-separated paths', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files= a.ts , b.ts '])).toEqual(['a.ts', 'b.ts']);
  });

  it('collects space-separated positional args after --files', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files', 'a.ts', 'b.ts'])).toEqual([
      'a.ts',
      'b.ts',
    ]);
  });

  it('stops collecting at the next flag when using space form', () => {
    expect(parseFilesArg(['bun', 'script.ts', '--files', 'a.ts', '--other'])).toEqual(['a.ts']);
  });
});

// ─── matchesTrigger ───────────────────────────────────────────────────────────

describe('matchesTrigger', () => {
  it('exact match', () => {
    expect(
      matchesTrigger('tests/helpers/boundary-values.ts', 'tests/helpers/boundary-values.ts'),
    ).toBe(true);
  });

  it('suffix match — monorepo root-relative path', () => {
    expect(
      matchesTrigger(
        'rapitas-backend/scripts/gen-boundary-guide.ts',
        'scripts/gen-boundary-guide.ts',
      ),
    ).toBe(true);
  });

  it('directory prefix trigger — matches file inside dir', () => {
    expect(matchesTrigger('eslint-rules/no-raw-prisma-insensitive.test.mjs', 'eslint-rules/')).toBe(
      true,
    );
  });

  it('directory prefix trigger — does not match file outside dir', () => {
    expect(matchesTrigger('scripts/something.ts', 'eslint-rules/')).toBe(false);
  });

  it('no match — different file', () => {
    expect(matchesTrigger('README.md', 'tests/helpers/boundary-values.ts')).toBe(false);
  });

  it('normalises backslashes to forward slashes', () => {
    expect(matchesTrigger('scripts\\gen-boundary-guide.ts', 'scripts/gen-boundary-guide.ts')).toBe(
      true,
    );
    expect(matchesTrigger('eslint-rules\\rule.ts', 'eslint-rules/')).toBe(true);
  });
});

// ─── selectTests ─────────────────────────────────────────────────────────────

const ALL_TESTS = [
  'scripts/gen-boundary-guide.test.ts',
  'scripts/gen-resolver-boundary-tests.test.ts',
  'eslint-rules/no-raw-prisma-insensitive.test.mjs',
  'tests/unregistered.test.ts',
];

const TRIGGERS: Record<string, string[]> = {
  'scripts/gen-boundary-guide.test.ts': [
    'tests/helpers/boundary-values.ts',
    'scripts/gen-boundary-guide.ts',
  ],
  'scripts/gen-resolver-boundary-tests.test.ts': [
    'tests/helpers/boundary-values.ts',
    'scripts/gen-resolver-boundary-tests.ts',
  ],
  'eslint-rules/no-raw-prisma-insensitive.test.mjs': ['eslint-rules/'],
};

describe('selectTests', () => {
  it.each([
    { label: 'changedFiles is null (flag absent)', changedFiles: null, triggers: TRIGGERS },
    {
      label: 'changedFiles is [] (flag present but empty)',
      changedFiles: [],
      triggers: TRIGGERS,
    },
    {
      label: 'triggers is null (trigger map unavailable)',
      changedFiles: ['README.md'],
      triggers: null,
    },
  ])('returns allTests when $label', ({ changedFiles, triggers }) => {
    expect(selectTests(ALL_TESTS, changedFiles, triggers)).toEqual(ALL_TESTS);
  });

  it('includes triggered tests when SSOT file is changed', () => {
    const result = selectTests(ALL_TESTS, ['tests/helpers/boundary-values.ts'], TRIGGERS);
    expect(result).toContain('scripts/gen-boundary-guide.test.ts');
    expect(result).toContain('scripts/gen-resolver-boundary-tests.test.ts');
  });

  it('excludes tests whose triggers do not match any changed file', () => {
    const result = selectTests(ALL_TESTS, ['tests/helpers/boundary-values.ts'], TRIGGERS);
    // eslint-rules test is not triggered by SSOT change
    expect(result).not.toContain('eslint-rules/no-raw-prisma-insensitive.test.mjs');
  });

  it('always includes unregistered tests regardless of changed files', () => {
    const result = selectTests(ALL_TESTS, ['README.md'], TRIGGERS);
    expect(result).toContain('tests/unregistered.test.ts');
  });

  it('returns empty array when all registered tests are filtered and none are unregistered', () => {
    const registeredOnly = ALL_TESTS.filter((t) => t !== 'tests/unregistered.test.ts');
    const result = selectTests(registeredOnly, ['README.md'], TRIGGERS);
    expect(result).toEqual([]);
  });

  it('triggers eslint-rules test when a file in eslint-rules/ is changed', () => {
    const result = selectTests(ALL_TESTS, ['eslint-rules/some-rule.ts'], TRIGGERS);
    expect(result).toContain('eslint-rules/no-raw-prisma-insensitive.test.mjs');
  });
});

// ─── loadTriggers ─────────────────────────────────────────────────────────────

describe('loadTriggers', () => {
  it('returns a non-null object when ci-gate-triggers.json exists', () => {
    const triggers = loadTriggers();
    // ci-gate-triggers.json exists in this repo
    expect(triggers).not.toBeNull();
    expect(typeof triggers).toBe('object');
  });

  it('loaded trigger map contains at least the boundary-guide test entry', () => {
    const triggers = loadTriggers();
    expect(triggers?.['scripts/gen-boundary-guide.test.ts']).toBeDefined();
  });
});
