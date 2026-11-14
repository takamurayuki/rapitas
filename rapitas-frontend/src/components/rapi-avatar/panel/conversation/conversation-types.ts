/**
 * conversation-types
 *
 * The shape of one line in ラピ's conversation. Modelled on the mobile app's
 * `RapiMessage` (rapitas-mobile/lib/models/rapi_chat/rapi_chat_message.dart):
 * what you said, what she said, the note saying where a sentence went, and
 * the card that answers it, all in one thread.
 */
import type { PromptDestination } from '../RapiPrompt';

/** Who a line is from. `system` is the routing note between the two. */
export type RapiRole = 'user' | 'assistant' | 'system';

export interface RapiMessage {
  id: number;
  role: RapiRole;
  text: string;
  /**
   * For a `system` line: the mode the sentence was routed to. The thread
   * draws that mode's card under the note, handed the sentence.
   */
  intent?: PromptDestination;
  /** The sentence that was routed, handed to the card. / カードに渡す文 */
  handedOver?: string;
  /** Why it was routed there, from the router. / 振り分けた理由 */
  reason?: string;
  /**
   * Whether the line is part of the history sent to `/copilot/chat`.
   * The greeting and failure notes are not; neither are the routed
   * sentences' cards.
   */
  inHistory: boolean;
  /** A failure note, drawn in the warning colour. / 失敗の案内 */
  failed?: boolean;
}
