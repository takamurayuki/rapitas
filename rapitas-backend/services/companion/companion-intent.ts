/**
 * CompanionIntent
 *
 * Tells "伴走して" / "伴走をやめて" apart from everything else said in a
 * consultation (companion design 4.3, 手動のタスク). Deterministic on purpose:
 * the only way it is wrong is by showing a confirmation card that writes
 * nothing until the user presses it, and a pattern can be read and tested in
 * a way a model's routing cannot.
 *
 * Questions about accompanying ("伴走って何？", "伴走してる？") are not
 * requests and fall through to the consultation itself.
 *
 * Pure. Not responsible for the card or the write — see
 * `routes/ai/assistant-companion.routes.ts`.
 */

/** What the user asked for. */
export type CompanionRequest = 'start' | 'stop';

/** The word every request contains. A cheap gate clients may mirror. */
export const COMPANION_KEYWORD = '伴走';

/** Ending or leaving: checked first, since "伴走をやめて" also contains a request form. */
const STOP =
  /伴走.{0,8}?(やめ|止め|とめ|外し|外す|外れ|はずし|はずす|解除|終わり|終わら|終え|終了|しないで|しなくて|いらな|不要|オフ)/;

/** Starting: an explicit request form right after the word. */
const START =
  /伴走.{0,6}?(して(?!る|い|た)|始め|はじめ|開始|対象に|頼|お願い|よろしく|つけ|付け|入れ|したい|してほし|して欲し)/;

/** A question about accompanying, not a request to change it. */
const QUESTION = /(とは|って何|ってなに|ってどう|してる\s*[?？]|中\s*[?？]|ですか|ますか)/;

/**
 * Read a request to start or stop accompanying the task in hand.
 *
 * @param text - What the user said / 発言
 * @returns 'start' / 'stop', or null when it is not such a request / 開始・終了の依頼か
 */
export function detectCompanionRequest(text: string): CompanionRequest | null {
  const t = text.trim();
  if (!t.includes(COMPANION_KEYWORD)) return null;
  if (STOP.test(t)) return 'stop';
  if (QUESTION.test(t)) return null;
  if (START.test(t)) return 'start';
  return null;
}
