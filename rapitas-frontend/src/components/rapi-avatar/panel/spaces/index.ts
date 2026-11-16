/**
 * spaces
 *
 * ラピ's conversation spaces on the web: shared with the mobile app through
 * `/rapi-chat/*`, switched from the panel's title.
 */
export { RapiSpaceSwitcher } from './RapiSpaceSwitcher';
export { useRapiSpaces, OPEN_SPACE_KEY, type RapiSpaces } from './useRapiSpaces';
export {
  fetchSpaces,
  createSpace,
  fetchMessages,
  putMessages,
  toSaved,
  fromSaved,
  LOAD_LIMIT,
  type RapiSpaceSummary,
  type SavedMessage,
} from './rapi-spaces-api';
