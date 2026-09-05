/**
 * prompt-language-store.test
 *
 * Round-trip and default behaviour of the file-backed prompt language.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { asPromptLanguage, readPromptLanguage, writePromptLanguage } from './prompt-language-store';

let dir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rapitas-prompt-language-'));
  previousDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = dir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previousDataDir;
  rmSync(dir, { recursive: true, force: true });
});

describe('readPromptLanguage', () => {
  test('defaults to ja when nothing was stored', () => {
    expect(readPromptLanguage()).toBe('ja');
  });

  test('falls back to ja on an unsupported stored value', () => {
    writeFileSync(join(dir, '.prompt-language'), 'fr');
    expect(readPromptLanguage()).toBe('ja');
  });

  test('round-trips en through writePromptLanguage', () => {
    writePromptLanguage('en');
    expect(existsSync(join(dir, '.prompt-language'))).toBe(true);
    expect(readPromptLanguage()).toBe('en');
    writePromptLanguage('ja');
    expect(readPromptLanguage()).toBe('ja');
  });
});

describe('asPromptLanguage', () => {
  test('accepts only ja / en', () => {
    expect(asPromptLanguage('ja')).toBe('ja');
    expect(asPromptLanguage('en')).toBe('en');
    expect(asPromptLanguage('EN')).toBeNull();
    expect(asPromptLanguage(undefined)).toBeNull();
    expect(asPromptLanguage(1)).toBeNull();
  });
});
