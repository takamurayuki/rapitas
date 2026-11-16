/**
 * Rapi chat services barrel
 *
 * Conversation spaces of ラピ's chat: a display record of what was said, never
 * read by the assistant pipeline (nav39 design).
 */
export * from './rapi-chat-types';
export {
  parsePutBody,
  parseCreateBody,
  validateItem,
  checkPayload,
  autoTitle,
} from './snapshot-limits';
export {
  listSpaces,
  createSpace,
  deleteSpace,
  toSpaceView,
  type SpaceView,
  type CreateSpaceResult,
} from './space-service';
export {
  listMessages,
  putMessages,
  pageLimit,
  type MessageView,
  type MessagePage,
  type PutResult,
} from './message-service';
