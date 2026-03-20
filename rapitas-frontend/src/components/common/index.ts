/**
 * common/index.ts
 *
 * Barrel file for shared/common components used across the application.
 */

export { ErrorBoundary } from './ErrorBoundary';
export { default as KeyboardShortcuts, OPEN_SHORTCUTS_EVENT } from './KeyboardShortcuts';
export { default as WindowResizeOptimizer } from './WindowResizeOptimizer';
export { default as CacheWarmupInitializer } from './CacheWarmupInitializer';
export { default as HtmlLangUpdater } from './HtmlLangUpdater';
export { ResumableExecutionsBanner } from './ResumableExecutionsBanner';
export { BackendConnectionError } from './BackendConnectionError';
export { default as AppIcon } from './app-icon';
export { default as ConditionalHeader } from './conditional-header';
export { DarkModeToggle } from './DarkModeToggle';
export { default as LanguageSwitcher } from './LanguageSwitcher';
export { default as Header } from './Header';
