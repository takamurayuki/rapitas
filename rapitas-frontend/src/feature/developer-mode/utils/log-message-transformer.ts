/**
 * LogMessageTransformer
 *
 * Public re-export barrel. Consumers should import from this path; the
 * implementation lives in the sub-modules below.
 *
 * Sub-modules:
 *   - log-pattern-rules    — types and regex pattern table
 *   - log-transformers     — line-level and batch transform functions
 *   - log-summary-generator — phase detection and execution summary
 */

export type {
  UserFriendlyLogCategory,
  UserFriendlyLogEntry,
  ExecutionSummary,
} from './log-pattern-rules';

export { transformLogToUserFriendly, transformLogsToSimple } from './log-transformers';

export {
  detectCurrentPhase,
  generateExecutionSummary,
} from './log-summary-generator';
