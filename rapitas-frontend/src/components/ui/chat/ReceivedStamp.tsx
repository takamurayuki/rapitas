/**
 * ReceivedStamp
 *
 * The small round 👌 badge pinned to the lower corner of a message the
 * assistant has taken in. It marks acceptance only; the caller decides
 * which messages were accepted (a failed or withdrawn send gets none).
 * The parent bubble must be `relative` for the badge to sit on its corner.
 */

/** The glyph on the badge. Mirrors rapitas-mobile `rapiStampGlyph`. */
export const RECEIVED_STAMP_GLYPH = '👌';

interface ReceivedStampProps {
  /** Spoken meaning of the badge, e.g. "ラピが受け付けました". / 読み上げ用の意味 */
  label: string;
}

/**
 * Renders the badge on the bubble's lower-left corner (the side facing the
 * conversation for a right-aligned bubble).
 *
 * @param props.label - Accessible meaning of the badge / 読み上げ用の意味
 */
export function ReceivedStamp({ label }: ReceivedStampProps) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-chat-received="true"
      className="pointer-events-none absolute -bottom-2 -left-2 flex h-[19px] w-[19px] items-center justify-center rounded-full border border-zinc-200 bg-white text-[11px] leading-none shadow-sm select-none dark:border-zinc-600 dark:bg-zinc-100"
    >
      {RECEIVED_STAMP_GLYPH}
    </span>
  );
}
