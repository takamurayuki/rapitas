/**
 * RapiProfileStore
 *
 * The standing self-introduction ラピ plans against — who the user is, what
 * they do, what constrains them — and its second half, how they like to
 * work.
 *
 * The roadmap interview asks who you are before it can plan anything, and it
 * asks again on the next roadmap, and the one after. That is work the user
 * already did. A profile answers it once and rides in front of every request
 * instead (asked for 2026-10-22).
 *
 * Kept on the account's own `UserSettings` row. It used to be two files in
 * RAPITAS_DATA_DIR, which was right while this app had one user and wrong the
 * moment accounts existed: every account on the install shared one
 * introduction and whoever saved last overwrote the others (#1275).
 * `UserSettings` carries `workspaceId` and is in owned-models, so the
 * workspace extension scopes these reads and writes per account without this
 * module knowing anything about workspaces.
 *
 * Not responsible for moving the old files onto the row — see
 * rapi-profile-backfill.ts — nor for deciding what ラピ does with the
 * profile, which is roadmap-prompts.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('system:rapi-profile');

/**
 * Longest profile that will be stored or read back.
 *
 * It rides in front of every roadmap request. Unbounded, the introduction
 * becomes the prompt and the thing actually being asked for becomes a
 * footnote — and the model's attention is the budget being spent.
 */
export const MAX_RAPI_PROFILE_LENGTH = 1200;

/** The two columns this module owns. */
type RapiField = 'rapiProfile' | 'rapiCharacter';

/** The part of a `UserSettings` row this module reads. */
export interface RapiSettingsRow {
  id: number;
  rapiProfile?: string | null;
  rapiCharacter?: string | null;
}

/**
 * Just enough of the `userSettings` delegate to carry the two fields.
 *
 * Injected rather than reached for so a test can hand over a fake table:
 * the alternative is `mock.module` on the Prisma client, which bun applies
 * process-wide to every other test file in the run.
 */
export interface SettingsDelegate {
  findFirst(args?: unknown): Promise<RapiSettingsRow | null>;
  create(args: unknown): Promise<RapiSettingsRow>;
  update(args: unknown): Promise<unknown>;
}

/**
 * The real, workspace-scoped delegate.
 *
 * NOTE: cast because the generated Prisma client does not carry
 * `rapiProfile` / `rapiCharacter` until it is regenerated on the next
 * backend restart — the same reason settings-extra-fields.ts writes its
 * pending columns through a cast. Until that restart a read finds no such
 * key and answers null, and a write is rejected; both are handled below.
 */
function settingsDelegate(): SettingsDelegate {
  return prisma.userSettings as unknown as SettingsDelegate;
}

/**
 * Trim the edges, keep the shape, and bound the length.
 *
 * @param value - Raw text from the user or the row / 入力または行の生の値
 * @returns The storable value, or null when it says nothing / 保存可能な値（空なら null）
 */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_RAPI_PROFILE_LENGTH);
}

/**
 * The settings row this account's profile lives on, lowest id first.
 *
 * Within a workspace there is one row, so the ordering only decides which
 * row wins if a workspace ever ends up with two — and then it should be the
 * same one every time rather than whichever the database felt like.
 */
async function findRow(delegate: SettingsDelegate): Promise<RapiSettingsRow | null> {
  return delegate.findFirst({ orderBy: { id: 'asc' } });
}

/**
 * Read one half of the profile.
 *
 * Fails SOFT: a settings page and a roadmap are both more useful without the
 * introduction than not at all, and between merging the column and the
 * restart that adds it every read here fails.
 */
async function readField(field: RapiField, delegate: SettingsDelegate): Promise<string | null> {
  try {
    const row = await findRow(delegate);
    const value = row?.[field];
    return typeof value === 'string' ? normalise(value) : null;
  } catch (err) {
    log.info({ err, field }, 'self-introduction could not be read');
    return null;
  }
}

/**
 * Persist one half of the profile, creating the settings row if the account
 * has none yet.
 *
 * Fails LOUD, unlike the file it replaced: the settings card reports success
 * on a 2xx, so swallowing the failure here makes the card lie about the
 * profile ラピ is planning against.
 */
async function writeField(
  field: RapiField,
  value: string,
  delegate: SettingsDelegate,
): Promise<void> {
  const existing = await findRow(delegate);
  const id = existing?.id ?? (await delegate.create({ data: {} })).id;
  await delegate.update({ where: { id }, data: { [field]: normalise(value) } });
}

/**
 * Read the standing self-introduction, if there is one.
 *
 * @param delegate - Settings delegate; defaults to the live one / 設定デリゲート（既定は本番）
 * @returns The profile, or null when none is set / 自己紹介（未設定なら null）
 */
export function readRapiProfile(
  delegate: SettingsDelegate = settingsDelegate(),
): Promise<string | null> {
  return readField('rapiProfile', delegate);
}

/**
 * Read what kind of person they are, if they have said.
 *
 * @param delegate - Settings delegate; defaults to the live one / 設定デリゲート（既定は本番）
 * @returns The character notes, or null when none is set / 人となり（未設定なら null）
 */
export function readRapiCharacter(
  delegate: SettingsDelegate = settingsDelegate(),
): Promise<string | null> {
  return readField('rapiCharacter', delegate);
}

/**
 * Persist the self-introduction. Blank clears it.
 *
 * @param value - What the user wrote about themselves / 自己紹介の本文
 * @param delegate - Settings delegate; defaults to the live one / 設定デリゲート（既定は本番）
 * @throws When the row cannot be written / 行を更新できなかった場合
 */
export function writeRapiProfile(
  value: string,
  delegate: SettingsDelegate = settingsDelegate(),
): Promise<void> {
  return writeField('rapiProfile', value, delegate);
}

/**
 * Persist the character notes. Blank clears them.
 *
 * @param value - What the user wrote about how they work / 人となりの本文
 * @param delegate - Settings delegate; defaults to the live one / 設定デリゲート（既定は本番）
 * @throws When the row cannot be written / 行を更新できなかった場合
 */
export function writeRapiCharacter(
  value: string,
  delegate: SettingsDelegate = settingsDelegate(),
): Promise<void> {
  return writeField('rapiCharacter', value, delegate);
}
