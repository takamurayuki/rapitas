/**
 * agent-guard-settings test
 *
 * Pins that the guard settings file lives in a backend-owned RAPITAS_DATA_DIR
 * subdirectory (never a predictable os.tmpdir() path) and is hash-verified.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  utimesSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { ensureGuardSettingsFile, verifyGuardSettingsFile } from './agent-guard-settings';

let dataDir: string;
let prev: string | undefined;

beforeEach(() => {
  prev = process.env.RAPITAS_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'guard-test-'));
  process.env.RAPITAS_DATA_DIR = dataDir;
});

afterEach(() => {
  if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = prev;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('ensureGuardSettingsFile', () => {
  it('writes under RAPITAS_DATA_DIR/agent-guard/run-*/settings.json', () => {
    const file = ensureGuardSettingsFile();
    expect(file).not.toBeNull();
    expect(file!.startsWith(join(dataDir, 'agent-guard'))).toBe(true);
    expect(dirname(file!)).toMatch(/run-/);
    expect(JSON.parse(readFileSync(file!, 'utf8')).hooks.PreToolUse).toBeDefined();
  });

  it('never uses the fixed os.tmpdir()/rapitas-agent-guard path', () => {
    const file = ensureGuardSettingsFile();
    expect(file).not.toBe(join(tmpdir(), 'rapitas-agent-guard', 'settings.json'));
  });

  it('gives each call its own directory', () => {
    const a = ensureGuardSettingsFile();
    const b = ensureGuardSettingsFile();
    expect(a).not.toBeNull();
    expect(dirname(a!)).not.toBe(dirname(b!));
  });

  it('returns null (fail-open) when the data dir is unwritable', () => {
    // A regular file where the directory should be makes mkdir fail.
    rmSync(dataDir, { recursive: true, force: true });
    writeFileSync(dataDir, 'x');
    expect(ensureGuardSettingsFile()).toBeNull();
    rmSync(dataDir, { force: true });
    mkdirSync(dataDir);
  });

  it('removes run directories older than 24h', () => {
    const fresh = ensureGuardSettingsFile()!;
    const old = join(dataDir, 'agent-guard', 'run-old');
    mkdirSync(old, { recursive: true });
    const past = new Date(Date.now() - 48 * 3600 * 1000);
    utimesSync(old, past, past);
    ensureGuardSettingsFile();
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });
});

describe('verifyGuardSettingsFile', () => {
  it('accepts an untouched file', () => {
    const file = ensureGuardSettingsFile()!;
    expect(verifyGuardSettingsFile(file, readFileSync(file, 'utf8'))).toBe(true);
  });

  it('rejects a file whose content was tampered with', () => {
    const file = ensureGuardSettingsFile()!;
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, '{"hooks":{}}');
    expect(verifyGuardSettingsFile(file, original)).toBe(false);
  });

  it('rejects a missing file', () => {
    expect(verifyGuardSettingsFile(join(dataDir, 'nope.json'), 'x')).toBe(false);
  });
});

describe('ensureGuardSettingsFile — data dir resolution', () => {
  it('falls back to ~/.rapitas/agent-guard when RAPITAS_DATA_DIR is unset', () => {
    delete process.env.RAPITAS_DATA_DIR;
    const file = ensureGuardSettingsFile();
    try {
      expect(file).not.toBeNull();
      expect(file!.startsWith(join(homedir(), '.rapitas', 'agent-guard'))).toBe(true);
    } finally {
      if (file) rmSync(dirname(file), { recursive: true, force: true });
    }
  });
});
