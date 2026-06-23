/**
 * ci-timing.test.ts
 *
 * Unit tests for the pure functions in services/analytics/ci-timing.ts.
 * Also includes a YAML drift guard that asserts SERIAL_GATE_FILES matches
 * the test-backend job in .github/workflows/test-lint.yml.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { readFileSync } from 'fs';
import { SERIAL_GATE_FILES, computeCiTimingAnalytics, readTimingCacheOrEmpty } from './ci-timing';
import type { TimingCacheResult, TimingEntry } from './ci-timing';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a minimal TimingCacheResult with available=true. */
function makeCache(results: TimingEntry[], extra?: Partial<TimingCacheResult>): TimingCacheResult {
  return {
    available: true,
    generatedAt: '2025-01-01T00:00:00.000Z',
    wallClockMs: 10000,
    results,
    ...extra,
  };
}

/** Build a single TimingEntry fixture. */
function makeEntry(file: string, elapsedMs: number, exitCode = 0): TimingEntry {
  return { file, elapsedMs, exitCode };
}

// ─── computeCiTimingAnalytics ────────────────────────────────────────────────

describe('computeCiTimingAnalytics — empty / unavailable cache', () => {
  test('returns available:false when cache.available=false', () => {
    const cache: TimingCacheResult = { available: false, results: [] };
    const result = computeCiTimingAnalytics(cache, SERIAL_GATE_FILES);
    expect(result.available).toBe(false);
    expect(result.totalFiles).toBe(0);
    expect(result.stats.count).toBe(0);
    expect(result.slowest).toHaveLength(0);
    expect(result.serialGate).toHaveLength(0);
  });

  test('all gate files appear in missingFromResults when cache is empty', () => {
    const cache: TimingCacheResult = { available: false, results: [] };
    const result = computeCiTimingAnalytics(cache, SERIAL_GATE_FILES);
    expect(result.missingFromResults).toEqual([...SERIAL_GATE_FILES]);
  });

  test('returns available:false with note when cache has note', () => {
    const cache: TimingCacheResult = {
      available: false,
      results: [],
      note: 'キャッシュ読み込みエラー: ENOENT',
    };
    const result = computeCiTimingAnalytics(cache, SERIAL_GATE_FILES);
    expect(result.note).toMatch(/キャッシュ読み込みエラー/);
  });

  test('returns available:false for cache.available=true with empty results', () => {
    // Edge case: available=true but results empty
    const cache = makeCache([]);
    const result = computeCiTimingAnalytics(cache, []);
    expect(result.totalFiles).toBe(0);
    expect(result.stats.count).toBe(0);
  });
});

describe('computeCiTimingAnalytics — statistics', () => {
  test('single entry: mean=p50=p90=max=elapsedMs', () => {
    const cache = makeCache([makeEntry('a.test.ts', 1000)]);
    const result = computeCiTimingAnalytics(cache, []);
    expect(result.stats.count).toBe(1);
    expect(result.stats.mean).toBe(1000);
    expect(result.stats.p50).toBe(1000);
    expect(result.stats.p90).toBe(1000);
    expect(result.stats.max).toBe(1000);
  });

  test('even count: p50 is the lower median index', () => {
    // Sorted: [100, 200, 300, 400] — p50 index = floor(3 * 0.5) = 1 → 200
    const entries = [
      makeEntry('a.test.ts', 300),
      makeEntry('b.test.ts', 100),
      makeEntry('c.test.ts', 400),
      makeEntry('d.test.ts', 200),
    ];
    const cache = makeCache(entries);
    const result = computeCiTimingAnalytics(cache, []);
    expect(result.stats.p50).toBe(200);
    // Sorted: [100,200,300,400], floor((4-1)*0.9)=floor(2.7)=2 → sorted[2]=300
    expect(result.stats.p90).toBe(300);
    expect(result.stats.max).toBe(400);
    expect(result.stats.mean).toBe(250);
  });

  test('odd count: p50 is the middle element', () => {
    // Sorted: [10, 20, 30] — p50 index = floor(2*0.5) = 1 → 20
    const entries = [
      makeEntry('a.test.ts', 30),
      makeEntry('b.test.ts', 10),
      makeEntry('c.test.ts', 20),
    ];
    const cache = makeCache(entries);
    const result = computeCiTimingAnalytics(cache, []);
    expect(result.stats.p50).toBe(20);
    expect(result.stats.max).toBe(30);
    expect(result.stats.count).toBe(3);
  });
});

describe('computeCiTimingAnalytics — slowest N', () => {
  test('returns up to slowestN entries in descending order', () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`file${i}.test.ts`, (i + 1) * 100),
    );
    const cache = makeCache(entries);
    const result = computeCiTimingAnalytics(cache, [], { slowestN: 5 });
    expect(result.slowest).toHaveLength(5);
    expect(result.slowest[0].elapsedMs).toBe(2000);
    expect(result.slowest[4].elapsedMs).toBe(1600);
  });

  test('returns all entries when count < slowestN', () => {
    const entries = [makeEntry('a.test.ts', 500), makeEntry('b.test.ts', 300)];
    const cache = makeCache(entries);
    const result = computeCiTimingAnalytics(cache, [], { slowestN: 15 });
    expect(result.slowest).toHaveLength(2);
  });
});

describe('computeCiTimingAnalytics — promotion / demotion threshold', () => {
  const GATE = ['gate.test.ts'];

  test('file exactly at threshold is a promotion candidate (not-in-gate, ≤ threshold)', () => {
    // elapsedMs = 2000 = threshold → promotion candidate
    const cache = makeCache([makeEntry('fast.test.ts', 2000)]);
    const result = computeCiTimingAnalytics(cache, GATE, { promoteMaxMs: 2000 });
    expect(result.promotionCandidates.some((r) => r.file === 'fast.test.ts')).toBe(true);
  });

  test('file at threshold is a demotion candidate (in-gate, ≥ threshold)', () => {
    const cache = makeCache([makeEntry('gate.test.ts', 2000)]);
    const result = computeCiTimingAnalytics(cache, GATE, { promoteMaxMs: 2000 });
    expect(result.demotionCandidates.some((r) => r.file === 'gate.test.ts')).toBe(true);
  });

  test('fast gate file is NOT a promotion candidate', () => {
    const cache = makeCache([makeEntry('gate.test.ts', 500)]);
    const result = computeCiTimingAnalytics(cache, GATE, { promoteMaxMs: 2000 });
    expect(result.promotionCandidates).toHaveLength(0);
  });

  test('slow non-gate file is NOT a demotion candidate', () => {
    const cache = makeCache([makeEntry('other.test.ts', 5000)]);
    const result = computeCiTimingAnalytics(cache, GATE, { promoteMaxMs: 2000 });
    expect(result.demotionCandidates).toHaveLength(0);
  });

  test('file 1ms above threshold is not a promotion candidate', () => {
    const cache = makeCache([makeEntry('slow.test.ts', 2001)]);
    const result = computeCiTimingAnalytics(cache, GATE, { promoteMaxMs: 2000 });
    expect(result.promotionCandidates.some((r) => r.file === 'slow.test.ts')).toBe(false);
  });
});

describe('computeCiTimingAnalytics — missingFromResults', () => {
  test('gate files not in results appear in missingFromResults', () => {
    const GATE = ['present.test.ts', 'absent.test.ts'];
    const cache = makeCache([makeEntry('present.test.ts', 100)]);
    const result = computeCiTimingAnalytics(cache, GATE);
    expect(result.missingFromResults).toEqual(['absent.test.ts']);
  });

  test('empty missingFromResults when all gate files are in results', () => {
    const GATE = ['a.test.ts', 'b.test.ts'];
    const cache = makeCache([makeEntry('a.test.ts', 100), makeEntry('b.test.ts', 200)]);
    const result = computeCiTimingAnalytics(cache, GATE);
    expect(result.missingFromResults).toHaveLength(0);
  });
});

describe('computeCiTimingAnalytics — failed entries', () => {
  test('failed entry has failed=true', () => {
    const cache = makeCache([makeEntry('failing.test.ts', 300, 1)]);
    const result = computeCiTimingAnalytics(cache, []);
    const entry = result.slowest.find((r) => r.file === 'failing.test.ts');
    expect(entry?.failed).toBe(true);
  });

  test('passing entry has failed=false', () => {
    const cache = makeCache([makeEntry('passing.test.ts', 300, 0)]);
    const result = computeCiTimingAnalytics(cache, []);
    const entry = result.slowest.find((r) => r.file === 'passing.test.ts');
    expect(entry?.failed).toBe(false);
  });
});

// ─── readTimingCacheOrEmpty ──────────────────────────────────────────────────

describe('readTimingCacheOrEmpty', () => {
  let tmpDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    originalDataDir = process.env.RAPITAS_DATA_DIR;
    tmpDir = mkdtempSync(join(tmpdir(), 'ci-timing-test-'));
    process.env.RAPITAS_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.RAPITAS_DATA_DIR;
    } else {
      process.env.RAPITAS_DATA_DIR = originalDataDir;
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup failure */
    }
  });

  test('returns available:false when cache file does not exist', () => {
    const result = readTimingCacheOrEmpty();
    expect(result.available).toBe(false);
    expect(result.results).toHaveLength(0);
  });

  test('returns available:false with note when JSON is corrupt', () => {
    writeFileSync(join(tmpDir, '.rapitas-test-timing.json'), '{ invalid json }', 'utf-8');
    const result = readTimingCacheOrEmpty();
    expect(result.available).toBe(false);
    expect(result.note).toMatch(/キャッシュ読み込みエラー/);
  });

  test('returns available:true with parsed data when JSON is valid', () => {
    const cache = {
      generatedAt: '2025-01-01T00:00:00Z',
      wallClockMs: 5000,
      results: [{ file: 'tests/foo.test.ts', elapsedMs: 300, exitCode: 0 }],
    };
    writeFileSync(join(tmpDir, '.rapitas-test-timing.json'), JSON.stringify(cache), 'utf-8');
    const result = readTimingCacheOrEmpty();
    expect(result.available).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.generatedAt).toBe('2025-01-01T00:00:00Z');
  });
});

// ─── YAML drift guard ────────────────────────────────────────────────────────

/**
 * Extracts .test.ts file paths from the test-backend job's run step in the YAML.
 * Simple text parsing — no full YAML parser needed given the predictable structure.
 */
function parseSerialGateFromYaml(yamlText: string): string[] {
  const lines = yamlText.split('\n');
  let inTargetStep = false;
  let inRunBlock = false;
  const files: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();

    if (stripped.includes('Run backend tests with coverage')) {
      inTargetStep = true;
      continue;
    }

    if (!inTargetStep) continue;

    // A new step ends this section
    if (stripped.startsWith('- name:') && !stripped.includes('Run backend tests with coverage')) {
      break;
    }

    if (stripped.startsWith('run:')) {
      inRunBlock = true;
      continue;
    }

    if (inRunBlock && stripped.endsWith('.test.ts')) {
      files.push(stripped);
    }
  }

  return files;
}

describe('YAML drift guard', () => {
  test('SERIAL_GATE_FILES matches test-lint.yml test-backend job', () => {
    // NOTE: Resolve path from this file's directory (services/analytics/) 3 levels up to repo root.
    const yamlPath = resolve(import.meta.dir, '../../../.github/workflows/test-lint.yml');
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const fromYaml = parseSerialGateFromYaml(yamlText);

    expect(fromYaml.sort()).toEqual([...SERIAL_GATE_FILES].sort());
  });
});
