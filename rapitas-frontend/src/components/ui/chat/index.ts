/**
 * Chat UI barrel
 *
 * Shared pieces of a chat log: the read stamp and its glyph rule, the typing dots, the
 * jump-to-latest button and the follow-the-newest-line hook. Used by ラピ's
 * conversation (rapi-avatar) and the task consult chat (copilot).
 */
export { ReceivedStamp, RECEIVED_STAMP_GLYPH } from './ReceivedStamp';
export {
  stampGlyphFor,
  intentOfRoutingNote,
  READ_AS_CHAT,
  SEND_FAILED_NOTES,
  STAMP_OK,
  STAMP_ON_IT,
  STAMP_WATCHING,
} from './read-stamp';
export { TypingDots } from './TypingDots';
export { JumpToLatestButton } from './JumpToLatestButton';
export {
  useChatFollow,
  JUMP_THRESHOLD_PX,
  FOLLOW_THRESHOLD_PX,
  type ChatFollow,
} from './useChatFollow';
