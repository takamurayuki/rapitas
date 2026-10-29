/**
 * rapi-profile-store.test
 *
 * What ラピ is told about the person she is planning for.
 *
 * Asked for 2026-10-22: the interview re-asks who you are on every roadmap,
 * which is work the user already did last time. A standing self-introduction
 * answers it once.
 *
 * File-backed rather than a Prisma column, the same way the prompt language
 * and the auto-restart toggle are, so it needs no schema change and no
 * restart to land.
 *
 * The tests are about the two ways this can hurt rather than help: a profile
 * long enough to crowd out the request it is supposed to inform, and a write
 * failure taking a settings request down with it.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  MAX_RAPI_PROFILE_LENGTH,
  readRapiCharacter,
  readRapiProfile,
  writeRapiCharacter,
  writeRapiProfile,
} from './rapi-profile-store';

let dir: string;
let previousDataDir: string | undefined;
const file = () => join(dir, '.rapi-profile');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rapitas-rapi-profile-'));
  previousDataDir = process.env.RAPITAS_DATA_DIR;
  process.env.RAPITAS_DATA_DIR = dir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = previousDataDir;
  rmSync(dir, { recursive: true, force: true });
});

describe('reading it back', () => {
  test('is null before anything has been said', () => {
    expect(readRapiProfile()).toBeNull();
  });

  test('round-trips what was written', () => {
    writeRapiProfile('30代のソフトウェアエンジニア。toB SaaS の経験が8年。');
    expect(existsSync(file())).toBe(true);
    expect(readRapiProfile()).toBe('30代のソフトウェアエンジニア。toB SaaS の経験が8年。');
  });

  test('keeps the line breaks someone wrote it with', () => {
    // A self-introduction is a short paragraph or a list, not one line, and
    // flattening it would change what the model is told.
    writeRapiProfile('職種: エンジニア\n希望: リモート\n制約: 平日夜のみ');
    expect(readRapiProfile()).toBe('職種: エンジニア\n希望: リモート\n制約: 平日夜のみ');
  });

  test('treats a blank file as nothing said', () => {
    writeFileSync(file(), '   \n  ');
    expect(readRapiProfile()).toBeNull();
  });

  test('is null when the file cannot be read', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(readRapiProfile()).toBeNull();
  });
});

describe('writing it', () => {
  test('trims the edges without touching the middle', () => {
    writeRapiProfile('  職種: エンジニア\n希望: リモート  ');
    expect(readRapiProfile()).toBe('職種: エンジニア\n希望: リモート');
  });

  test('clears it when given nothing', () => {
    writeRapiProfile('書いた');
    writeRapiProfile('   ');
    expect(readRapiProfile()).toBeNull();
  });

  test('caps what it will store', () => {
    // The profile rides in front of every roadmap request. Unbounded, it
    // becomes the prompt and the thing actually being asked for becomes a
    // footnote.
    writeRapiProfile('あ'.repeat(MAX_RAPI_PROFILE_LENGTH + 500));
    expect(readRapiProfile()?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });

  test('caps what it will read back, however the file got that long', () => {
    // Editing the file by hand is not the supported path, but it must not
    // be able to smuggle an unbounded prompt in either.
    writeFileSync(file(), 'い'.repeat(MAX_RAPI_PROFILE_LENGTH + 500));
    expect(readRapiProfile()?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });

  test('does not throw when the file cannot be written', () => {
    // A settings request must not fail because a best-effort file did.
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, 'not a directory');
    expect(() => writeRapiProfile('書いた')).not.toThrow();
  });
});

describe('the second half: what kind of person they are', () => {
  /**
   * Facts and character are stored apart on purpose.
   *
   * The facts say what someone CAN do — the role, the hours, the
   * constraints. The character says what they actually want out of it, and
   * that is the half that decides whether a plan is the RIGHT plan rather
   * than merely a feasible one. Kept separate so the prompt can label them
   * separately, and so clearing one never clears the other.
   */
  test('is nothing until it is written', () => {
    expect(readRapiCharacter()).toBeNull();
  });

  test('round-trips what was written', () => {
    writeRapiCharacter('納得してから動きたい。人数の多い場が苦手。');
    expect(readRapiCharacter()).toBe('納得してから動きたい。人数の多い場が苦手。');
  });

  test('does not share a slot with the facts', () => {
    writeRapiProfile('エンジニア8年');
    writeRapiCharacter('納得してから動きたい');
    expect(readRapiProfile()).toBe('エンジニア8年');
    expect(readRapiCharacter()).toBe('納得してから動きたい');
  });

  test('clearing one leaves the other alone', () => {
    writeRapiProfile('エンジニア8年');
    writeRapiCharacter('納得してから動きたい');
    writeRapiCharacter('');
    expect(readRapiCharacter()).toBeNull();
    expect(readRapiProfile()).toBe('エンジニア8年');
  });

  test('is capped the same way', () => {
    writeRapiCharacter('う'.repeat(MAX_RAPI_PROFILE_LENGTH + 500));
    expect(readRapiCharacter()?.length).toBe(MAX_RAPI_PROFILE_LENGTH);
  });

  test('does not throw when it cannot be written', () => {
    rmSync(dir, { recursive: true, force: true });
    writeFileSync(dir, 'not a directory');
    expect(() => writeRapiCharacter('書いた')).not.toThrow();
  });
});
