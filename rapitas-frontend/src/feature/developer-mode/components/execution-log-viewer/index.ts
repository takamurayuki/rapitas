/**
 * execution-log-viewer/index.ts
 *
 * Barrel file for the ExecutionLogViewer component family.
 * Import from this path rather than individual sub-module files to keep
 * consumer imports stable when the internal structure changes.
 */

export { ExecutionLogViewer } from './ExecutionLogViewer';
export { default } from './ExecutionLogViewer';

export type { ExecutionLogStatus, ExecutionLogViewMode, ExecutionLogViewerProps } from './types';

// Named sub-components exposed for advanced composition use-cases
export { LogEntry } from './LogEntry';
export { ExecutionSummaryCard } from './ExecutionSummaryCard';
export { LiveStatsBar } from './LiveStatsBar';
export { LogViewerHeader } from './LogViewerHeader';
export { useLogViewer } from './useLogViewer';
export { useLogSearch } from './useLogSearch';

// Utility functions exposed for reuse in other log-related components
export { formatLogLine, formatNestedValue, isFilePath } from './log-format-utils';
export type { FormattedLogLine } from './log-format-utils';
