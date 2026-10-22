/**
 * RapiProfileStore
 *
 * File-backed persistence for the standing self-introduction ラピ plans
 * against: who the user is, what they do, what constrains them.
 *
 * The roadmap interview asks who you are before it can plan anything, and
 * it asks again on the next roadmap, and the one after. That is work the
 * user already did. A profile answers it once and rides in front of every
 * request instead (asked for 2026-10-22).
 *
 * Lives in RAPITAS_DATA_DIR (default ~/.rapitas) rather than a Prisma
 * column, the same mechanism as prompt-language-store.ts and
 * auto-restart-merged-code/settings-store.ts: no schema change, so no
 * restart to deploy it.
 *
 * Not responsible for deciding what ラピ does with it — see
 * roadmap-prompts.ts, which places it in the message.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/**
 * Longest profile that will be stored or read back.
 *
 * It rides in front of every roadmap request. Unbounded, the introduction
 * becomes the prompt and the thing actually being asked for becomes a
 * footnote — and the model's attention is the budget being spent.
 */
export const MAX_RAPI_PROFILE_LENGTH = 1200;

function dataDir(): string {
  return process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas');
}

function profileFile(): string {
  return join(dataDir(), '.rapi-profile');
}

/**
 * Where the character half lives.
 *
 * A separate file, not a second paragraph in the first one. The facts say
 * what someone CAN do — the role, the hours, the constraints. The character
 * says what they actually want out of it, and that is the half that decides
 * whether a plan is the RIGHT plan rather than merely a feasible one. Apart,
 * the prompt can label them for what they are, and clearing one cannot take
 * the other with it.
 */
function characterFile(): string {
  return join(dataDir(), '.rapi-character');
}

/** Read one of the profile files, bounded and trimmed. */
function readFile(path: string): string | null {
  try {
    return normalise(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Write one of the profile files, best-effort. */
function writeFile(path: string, value: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, normalise(value) ?? '');
  } catch {
    // Never let a settings write failure crash a request.
  }
}

/** Trim the edges, keep the shape, and bound the length. */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_RAPI_PROFILE_LENGTH);
}

/**
 * Read the standing self-introduction, if there is one.
 *
 * Capped on the way out as well as in: editing the file by hand is not the
 * supported path, but it must not be able to smuggle an unbounded prompt in.
 *
 * @returns The profile, or null when none is set / 自己紹介（未設定なら null）
 */
export function readRapiProfile(): string | null {
  return readFile(profileFile());
}

/**
 * Read what kind of person they are, if they have said.
 *
 * @returns The character notes, or null when none is set / 人となり（未設定なら null）
 */
export function readRapiCharacter(): string | null {
  return readFile(characterFile());
}

/**
 * Persist the character notes. Blank clears them.
 *
 * @param value - What the user wrote about how they work / 人となりの本文
 */
export function writeRapiCharacter(value: string): void {
  writeFile(characterFile(), value);
}

/**
 * Persist the self-introduction. Blank clears it.
 *
 * Best-effort: a failed write leaves the previous profile in place and never
 * fails the settings request that carried it.
 *
 * @param value - What the user wrote about themselves / 自己紹介の本文
 */
export function writeRapiProfile(value: string): void {
  writeFile(profileFile(), value);
}
