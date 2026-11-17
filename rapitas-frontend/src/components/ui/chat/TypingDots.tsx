/**
 * TypingDots
 *
 * The "she is thinking" mark for a chat: three dots in an assistant-side
 * bubble that wave up and down out of phase, with no words. The mobile app
 * draws the same thing (rapitas-mobile/lib/screens/rapi/rapi_typing_indicator.dart).
 * It only draws the dots; when to show them is the caller's call.
 */

/** Delay between neighbouring dots, so they wave rather than bounce together. */
const DOT_DELAYS_MS = [0, 160, 320];

interface TypingDotsProps {
  /** Spoken name of the indicator, e.g. "考えています…". / 読み上げ用の名前 */
  label: string;
}

/**
 * Renders the waving dots inside a left-aligned assistant bubble.
 *
 * @param props.label - Accessible name of the indicator / 読み上げ用の名前
 */
export function TypingDots({ label }: TypingDotsProps) {
  return (
    <div className="flex justify-start" data-chat-typing="true">
      <div
        role="status"
        aria-label={label}
        className="inline-flex items-end gap-1 rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 pt-2.5 pb-3 dark:bg-zinc-800"
      >
        {DOT_DELAYS_MS.map((delay) => (
          // NOTE: the wave tracks a real state (a reply is on its way) and stops
          // with it, so it is feedback, not ambient motion
          // (docs/design/ui-design-language.md tell #4). Reduced motion keeps
          // the dots still.
          <span
            key={delay}
            aria-hidden="true"
            data-chat-typing-dot="true"
            className="block h-[7px] w-[7px] rounded-full bg-violet-400 animate-[chat-typing-wave_1.2s_ease-in-out_infinite] motion-reduce:animate-none dark:bg-violet-300"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
