/**
 * quality-gates-definition.test
 *
 * Pins how the auto-merge reads .github/quality-gates.json (#1410): only
 * required + conditional entries block, and every way the file can be
 * unusable comes back as `ok: false` (the caller then merges nothing).
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadQualityGateBlockingChecks, QUALITY_GATES_FILE } from './quality-gates-definition';

const dir = mkdtempSync(join(tmpdir(), 'quality-gates-def-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function writeGates(name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('loadQualityGateBlockingChecks', () => {
  it('returns required and conditional names, never advisory ones', () => {
    const file = writeGates(
      'ok.json',
      JSON.stringify({
        checks: [
          { name: 'A', mode: 'required' },
          { name: 'B', mode: 'conditional' },
          { name: 'C', mode: 'advisory' },
        ],
      }),
    );
    expect(loadQualityGateBlockingChecks(file)).toEqual({ ok: true, names: ['A', 'B'] });
  });

  it('fails closed on a missing file', () => {
    const result = loadQualityGateBlockingChecks(join(dir, 'absent.json'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('cannot read');
  });

  it('fails closed on malformed JSON', () => {
    expect(loadQualityGateBlockingChecks(writeGates('bad.json', '{ "checks": [')).ok).toBe(false);
  });

  it('fails closed when "checks" is missing or an entry lacks a name', () => {
    expect(loadQualityGateBlockingChecks(writeGates('none.json', '{}')).ok).toBe(false);
    const noName = writeGates('noname.json', JSON.stringify({ checks: [{ mode: 'required' }] }));
    expect(loadQualityGateBlockingChecks(noName).ok).toBe(false);
  });

  it('fails closed when nothing blocks (an empty set would merge without CI)', () => {
    const file = writeGates(
      'advisory-only.json',
      JSON.stringify({ checks: [{ name: 'C', mode: 'advisory' }] }),
    );
    const result = loadQualityGateBlockingChecks(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no required/conditional');
  });

  it('reads the committed repo file by default', () => {
    const result = loadQualityGateBlockingChecks();
    expect(QUALITY_GATES_FILE.replace(/\\/g, '/')).toEndWith('.github/quality-gates.json');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.names).toContain('Test Backend');
  });
});
