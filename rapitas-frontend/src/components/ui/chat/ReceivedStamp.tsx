/**
 * ReceivedStamp
 *
 * The small round badge pinned to the lower-right corner of a message once
 * the assistant has read it and started on it (like a read receipt). Its
 * glyph says what she took it as — see `stampGlyphFor` in `read-stamp.ts`.
 * The caller decides which messages were read (a sending or failed one gets
 * none). The parent bubble must be `relative` for the badge to sit on its
 * corner.
 */

/**
 * The glyph a sentence got before nav63, when every stamp was the same.
 * Kept for callers that have no intent; prefer `stampGlyphFor`.
 */
export const RECEIVED_STAMP_GLYPH = '👌';

interface ReceivedStampProps {
  /** Spoken meaning of the badge, e.g. "ラピが確認しました". / 読み上げ用の意味 */
  label: string;
  /** The glyph for the turn's intent (🫡 / 👀 / 👌). / スタンプの字 */
  glyph?: string;
}

/**
 * Renders the badge on the bubble's lower-right corner.
 *
 * @param props.label - Accessible meaning of the badge / 読み上げ用の意味
 * @param props.glyph - Glyph for the turn's intent / 意図の字
 */
export function ReceivedStamp({ label, glyph = RECEIVED_STAMP_GLYPH }: ReceivedStampProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-chat-received={glyph}
      // NOTE: moved from the lower-left to the lower-right corner (nav63), where a read receipt sits.
      className="pointer-events-none absolute -right-2 -bottom-2 flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-200 bg-white text-[11px] leading-none shadow-sm select-none dark:border-zinc-600 dark:bg-zinc-100"
    >
      {glyph}
    </span>
  );
}
