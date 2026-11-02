/**
 * feature-reachability unit tests
 *
 * Covers entry-point declaration parsing, the pure reachability verdict and
 * the composition with the smoke verdict.
 */
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFeatureEntries,
  evaluateFeatureReachability,
  applyFeatureReachability,
  readDeclaredFeatures,
  type FeatureEntry,
  type EntryReader,
} from './feature-reachability';

const entries: FeatureEntry[] = [
  { id: 'F-01', file: 'a.tsx' },
  { id: 'F-02', file: 'b.tsx', marker: 'PanelB' },
  { id: 'F-05', file: 'c.tsx' },
];

function reader(files: Record<string, string | Error>): EntryReader {
  return async (file) => {
    const v = files[file];
    if (v === undefined) return { content: null };
    if (v instanceof Error) return { error: v.message };
    return { content: v };
  };
}

describe('parseFeatureEntries', () => {
  it('returns no entries when undeclared', () => {
    expect(parseFeatureEntries(undefined)).toEqual({});
  });
  it('normalizes ids to upper case', () => {
    const r = parseFeatureEntries([{ id: 'f-01', file: 'x/a.tsx', marker: 'M' }]);
    expect(r.entries).toEqual([{ id: 'F-01', file: 'x/a.tsx', marker: 'M' }]);
  });
  it('rejects non-arrays, traversal, absolute paths, duplicates and > 50 items', () => {
    expect(parseFeatureEntries({}).error).toBeTruthy();
    expect(parseFeatureEntries([{ id: 'F-1', file: '../x' }]).error).toBeTruthy();
    expect(parseFeatureEntries([{ id: 'F-1', file: '/etc/x' }]).error).toBeTruthy();
    expect(parseFeatureEntries([{ id: 'F-1', file: 'C:/x' }]).error).toBeTruthy();
    expect(parseFeatureEntries([{ id: '', file: 'x' }]).error).toBeTruthy();
    expect(
      parseFeatureEntries([
        { id: 'F-1', file: 'a' },
        { id: 'f-1', file: 'b' },
      ]).error,
    ).toBeTruthy();
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `F-${i}`, file: 'a' }));
    expect(parseFeatureEntries(many).error).toBeTruthy();
  });
});

describe('evaluateFeatureReachability', () => {
  it('reachable when every entry exists with its marker', async () => {
    const r = await evaluateFeatureReachability(
      entries,
      reader({ 'a.tsx': 'x', 'b.tsx': 'PanelB', 'c.tsx': 'y' }),
    );
    expect(r.status).toBe('reachable');
    expect(r.present).toHaveLength(3);
    expect(r.missing).toEqual([]);
  });
  it('unreachable lists missing features in declaration order', async () => {
    const r = await evaluateFeatureReachability(entries, reader({ 'a.tsx': 'x' }));
    expect(r.status).toBe('unreachable');
    expect(r.missing).toEqual(['F-02', 'F-05']);
  });
  it('treats empty, whitespace-only and marker-less files as missing', async () => {
    const r = await evaluateFeatureReachability(
      entries,
      reader({ 'a.tsx': '', 'b.tsx': 'other', 'c.tsx': '  \n ' }),
    );
    expect(r.missing).toEqual(['F-01', 'F-02', 'F-05']);
  });
  it('unknown when undeclared or empty', async () => {
    for (const e of [undefined, []]) {
      const r = await evaluateFeatureReachability(e, reader({}));
      expect(r.status).toBe('unknown');
      expect(r.reason).toBeTruthy();
    }
  });
  it('unknown on read errors only; unreachable when a definite miss coexists', async () => {
    const onlyErr = await evaluateFeatureReachability(
      [{ id: 'F-01', file: 'a.tsx' }],
      reader({ 'a.tsx': new Error('EACCES') }),
    );
    expect(onlyErr.status).toBe('unknown');
    const mixed = await evaluateFeatureReachability(
      entries,
      reader({ 'a.tsx': new Error('EACCES'), 'b.tsx': 'zzz', 'c.tsx': 'y' }),
    );
    expect(mixed.status).toBe('unreachable');
    expect(mixed.missing).toEqual(['F-02']);
  });
});

describe('applyFeatureReachability', () => {
  const okVerdict = { ok: true, errorCount: 0, lines: ['✓ /: HTTP 200'] };

  it('fails the verdict and names unreachable features', async () => {
    const v = await applyFeatureReachability(
      okVerdict,
      { featureEntries: entries },
      '/w',
      reader({ 'a.tsx': 'x' }),
    );
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(2);
    const text = v.lines.join('\n');
    expect(text).toContain('F-02');
    expect(text).toContain('F-05');
  });
  it('keeps ok and records 判定不能 when undeclared', async () => {
    const v = await applyFeatureReachability(okVerdict, {}, '/w', reader({}));
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
    expect(v.lines.join('\n')).toContain('判定不能');
  });
  it('never turns a failed smoke verdict into ok', async () => {
    const failed = { ok: false, errorCount: 1, lines: ['✗ /'] };
    const v = await applyFeatureReachability(
      failed,
      { featureEntries: entries },
      '/w',
      reader({ 'a.tsx': 'x', 'b.tsx': 'PanelB', 'c.tsx': 'y' }),
    );
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(1);
    expect(v.lines.join('\n')).toContain('3/3');
  });
});

/**
 * `requireEntries` is set for the task whose job it is to register the entry —
 * the `[UI]` screen task. Without it, a screen task could register nothing and
 * still pass, which is the pass-through that kept this whole check inert.
 */
describe('applyFeatureReachability with requireEntries', () => {
  const okVerdict = { ok: true, errorCount: 0, lines: ['✓ /: HTTP 200'] };

  it('fails when nothing is declared', async () => {
    const v = await applyFeatureReachability(okVerdict, {}, '/w', reader({}), {
      requireEntries: true,
    });
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(1);
    expect(v.lines.join('\n')).toContain('featureEntries');
  });

  it('fails when the list is declared but empty', async () => {
    const v = await applyFeatureReachability(okVerdict, { featureEntries: [] }, '/w', reader({}), {
      requireEntries: true,
    });
    expect(v.ok).toBe(false);
    expect(v.errorCount).toBe(1);
  });

  it('still passes when an entry file cannot be read, because that is infrastructure', async () => {
    // Same principle as red-state-check: a transient I/O problem must never
    // block a legitimately good change. Only a confirmed absence is a failure.
    const v = await applyFeatureReachability(
      okVerdict,
      { featureEntries: [{ id: 'F-01', file: 'a.tsx' }] },
      '/w',
      reader({ 'a.tsx': new Error('EACCES') }),
      { requireEntries: true },
    );
    expect(v.ok).toBe(true);
    expect(v.lines.join('\n')).toContain('判定不能');
  });

  it('passes unchanged when the entries are there', async () => {
    const v = await applyFeatureReachability(
      okVerdict,
      { featureEntries: [{ id: 'F-01', file: 'a.tsx' }] },
      '/w',
      reader({ 'a.tsx': 'x' }),
      { requireEntries: true },
    );
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
    expect(v.lines.join('\n')).toContain('1/1');
  });

  it('leaves every other task on the old pass-through', async () => {
    const v = await applyFeatureReachability(okVerdict, {}, '/w', reader({}));
    expect(v.ok).toBe(true);
    expect(v.errorCount).toBe(0);
  });
});

/**
 * #1037: `[UI] ログイン` registered `{ id: "login" }` — a screen name, not a
 * declared `[F-NN]` — and "✓ 入口確認: n/n 機能" counted it as a feature. With
 * the declared ids known, such an entry is reported by name and not counted.
 */
describe('applyFeatureReachability with declaredFeatures', () => {
  const okVerdict = { ok: true, errorCount: 0, lines: ['✓ /: HTTP 200'] };
  const declared = new Set(['F-01', 'F-02']);

  it('does not count an entry whose id is no declared feature, and names it', async () => {
    const v = await applyFeatureReachability(
      okVerdict,
      {
        featureEntries: [
          { id: 'F-01', file: 'a.tsx' },
          { id: 'LOGIN', file: 'login.tsx' },
        ],
      },
      '/w',
      reader({ 'a.tsx': 'x', 'login.tsx': 'y' }),
      { declaredFeatures: declared },
    );
    expect(v.ok).toBe(true);
    const text = v.lines.join('\n');
    expect(text).toContain('1/1');
    expect(text).toContain('LOGIN');
    expect(text).not.toContain('2/2');
  });

  it('an undeclared id cannot satisfy requireEntries on its own', async () => {
    const v = await applyFeatureReachability(
      okVerdict,
      { featureEntries: [{ id: 'LOGIN', file: 'login.tsx' }] },
      '/w',
      reader({ 'login.tsx': 'y' }),
      { declaredFeatures: declared, requireEntries: true },
    );
    expect(v.ok).toBe(false);
    expect(v.lines.join('\n')).toContain('LOGIN');
  });

  // Only the 機能要件 section declares; ids cited in 受入条件 (F-09) do not.
  it('reads the declared ids from the 機能要件 section of docs/requirements.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fr-decl-'));
    try {
      mkdirSync(join(dir, 'docs'));
      writeFileSync(
        join(dir, 'docs', 'requirements.md'),
        '# 機能要件\n\n- [F-01] 一覧\n### [F-02] 詳細\n\n# 受入条件\n\n- [F-09] Given …\n',
      );
      expect([...((await readDeclaredFeatures(dir)) ?? [])].sort()).toEqual(['F-01', 'F-02']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('has no declared set when requirements.md is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fr-decl-'));
    try {
      expect(await readDeclaredFeatures(dir)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('without a declared set (no requirements.md) entries are taken as before', async () => {
    const v = await applyFeatureReachability(
      okVerdict,
      { featureEntries: [{ id: 'LOGIN', file: 'login.tsx' }] },
      '/w',
      reader({ 'login.tsx': 'y' }),
    );
    expect(v.ok).toBe(true);
    expect(v.lines.join('\n')).toContain('1/1');
  });
});
