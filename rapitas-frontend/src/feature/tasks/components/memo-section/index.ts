/**
 * memo-section barrel
 *
 * Public API for the memo-section feature module. Import from this file
 * rather than from individual sub-modules to keep import paths stable.
 */

export { default as MemoSection } from './MemoSection';
export { default } from './MemoSection';

export { NoteItem } from './NoteItem';
export { NoteEditForm } from './NoteEditForm';
export { NoteReplyInput } from './NoteReplyInput';
export { NoteActionBar } from './NoteActionBar';
export { MemoAnalysisDisplay } from './MemoAnalysisDisplay';
export { MemoStatsBar } from './MemoStatsBar';
export { MemoInputArea } from './MemoInputArea';
export { TaskActivityItem } from './TaskActivityItem';
export { TaskTimeline } from './TaskTimeline';
export { TemplateSelector } from './TemplateSelector';
export { useMemoSection } from './useMemoSection';

export type {
  MemoType,
  TaskActivity,
  MemoAnalysis,
  NoteData,
  MemoTemplate,
  Props,
} from './types';
export { MEMO_TEMPLATES, MEMO_TYPE_CONFIG } from './types';
export { timeAgo, analyzeMemo, generateMockTaskActivities } from './memo-utils';
