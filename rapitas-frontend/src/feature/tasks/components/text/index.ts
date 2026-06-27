/**
 * text
 *
 * Public API for task text/markdown UI (inline editing, markdown rendering, description, title autocomplete).
 */

export { default as InlineEditableText } from './InlineEditableText';
export { createMarkdownComponents } from './MarkdownComponents';
export { default as TaskDescription } from './TaskDescription';
export {
  default as TaskTitleAutocomplete,
  type TaskTitleAutocompleteRef,
} from './TaskTitleAutocomplete';
