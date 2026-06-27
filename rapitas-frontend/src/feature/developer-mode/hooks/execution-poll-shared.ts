/**
 * executionPollShared
 *
 * Shared logger and ref types for the execution polling handlers.
 * Holds only cross-handler primitives — status-specific logic lives in the
 * sibling completion/terminal/loop modules.
 */

import { createLogger } from '@/lib/logger';

export const logger = createLogger('ExecutionStream');

export type PollRefs = {
  lastProcessedStatusRef: React.MutableRefObject<string | null>;
  hasAddedFinalLogRef: React.MutableRefObject<boolean>;
  lastProcessedQuestionRef: React.MutableRefObject<string | null>;
  responseGraceUntilRef: React.MutableRefObject<number>;
  clearedQuestionRef: React.MutableRefObject<string | null>;
  terminalStatusGraceUntilRef: React.MutableRefObject<number>;
  /**
   * Tracks the most recent `executionId` returned by the status endpoint.
   * When the orchestrator auto-advances (implementer → verifier etc.) it
   * spawns a NEW AgentExecution row inside the same task, with a different
   * id. Detecting the change lets us reset the output cursor and the
   * "final-log emitted" flag so the new phase's logs surface immediately
   * — which is what the user expected when they said "画面を再読み込みし
   * ないとログが表示されない".
   */
  lastExecutionIdRef: React.MutableRefObject<number | null>;
};
