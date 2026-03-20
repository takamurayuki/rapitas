/**
 * Screenshot Service
 *
 * Re-exports from the screenshot sub-module directory.
 * Maintained for backward compatibility — import from this path as before.
 */

export type { ScreenshotResult, ScreenshotOptions, ProjectInfo } from '../screenshot/types';
export { detectProjectInfo } from '../screenshot/project-detector';
export {
  hasUIChanges,
  detectAffectedPages,
  detectAllPages,
  detectPagesFromAgentOutput,
} from '../screenshot/page-scanner';
export {
  captureScreenshots,
  captureAllScreenshots,
  captureScreenshotsForDiff,
} from '../screenshot/capture';
