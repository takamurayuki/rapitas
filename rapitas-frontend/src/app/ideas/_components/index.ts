/**
 * IdeaBoxComponents
 *
 * Public barrel for the IdeaBox feature. Re-exports the page entry component
 * (default) and the supporting hook/types for reuse.
 */
export { default } from './IdeasClient';
export { default as IdeasClient } from './IdeasClient';
export { IdeaBoxHeader } from './IdeaBoxHeader';
export { useIdeaBox } from './use-idea-box';
export type { Idea, IdeaPriority, IdeaScope, IdeaStats } from './idea-box.types';
