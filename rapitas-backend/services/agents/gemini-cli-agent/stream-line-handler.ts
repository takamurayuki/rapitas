/**
 * GeminiCliAgent — Stream Line Handler
 *
 * Handles one complete stdout line of the Gemini CLI: JSON events (question
 * tools, session/checkpoint ids, display text) or raw non-JSON text. Moved
 * unchanged out of stream-handler.ts (300-line threshold); not responsible
 * for line buffering, timers or process lifecycle.
 */
import type { GeminiCliAgentConfig, GeminiStreamEvent } from './types';
import {
  detectQuestionFromToolCall,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
} from '../question-detection';
import type { QuestionWaitingState } from '../question-detection';
import { parseStreamEvent, isNoiseLine } from './output-parser';
import { createLogger } from '../../../config/logger';
import { shouldHideRawCliLine } from '../cli-output-filter';
import type { StreamHandlerCallbacks } from './stream-handler';

const logger = createLogger('gemini-cli-agent:stream-handler');

/** Per-process state the line handler reads and updates. */
export interface StreamLineContext {
  config: GeminiCliAgentConfig;
  logPrefix: string;
  activeTools: Map<string, { name: string; startTime: number; info: string }>;
  sessionState: { sessionId: string | null; checkpointId: string | null };
  detectedQuestionRef: { value: QuestionWaitingState };
  callbacks: StreamHandlerCallbacks;
}

/**
 * Process one stdout line.
 *
 * @param line - One line without its newline / 改行を除いた1行
 * @param ctx - Shared per-process state and callbacks / プロセス単位の状態とコールバック
 */
export function handleGeminiStreamLine(line: string, ctx: StreamLineContext): void {
  const { config, logPrefix, activeTools, sessionState, detectedQuestionRef, callbacks } = ctx;
  if (!line.trim()) return;

  try {
    const json = JSON.parse(line) as GeminiStreamEvent;
    const timestamp = new Date().toISOString();
    logger.info(`${logPrefix} [${timestamp}] Event type: ${json.type}`);

    // Handle AskUserQuestion tool specially — pause and emit question
    if (json.type === 'assistant' && json.message?.content) {
      let questionHandled = false;
      for (const block of json.message.content) {
        if (
          block.type === 'tool_use' &&
          (block.name === 'AskUserQuestion' || block.name === 'ask_user' || block.name === 'ask')
        ) {
          logger.info(`${logPrefix} Question tool detected: ${block.name}`);

          const detectionResult = detectQuestionFromToolCall(
            'AskUserQuestion',
            block.input,
            config.timeout ? Math.floor(config.timeout / 1000) : undefined,
          );

          const newState = updateWaitingStateFromDetection(detectionResult);
          detectedQuestionRef.value = newState;

          callbacks.onQuestionDetected(newState);
          callbacks.onQuestionEmit({
            question: detectionResult.questionText,
            questionType: tolegacyQuestionType(newState.questionType),
            questionDetails: newState.questionDetails,
            questionKey: newState.questionKey,
          });

          const displayOutput = `\n[質問] ${detectionResult.questionText}\n`;
          callbacks.onOutputBufferAppend(displayOutput);
          callbacks.onOutput(displayOutput);

          // NOTE: Kill process to wait for user response before continuing
          logger.info(`${logPrefix} Stopping process to wait for user response`);
          callbacks.onKillProcess();
          questionHandled = true;
          break;
        }
      }
      if (questionHandled) return;
    }

    const prevSessionId = sessionState.sessionId;
    const prevCheckpointId = sessionState.checkpointId;
    const displayOutput = parseStreamEvent(json, activeTools, sessionState);

    if (sessionState.sessionId !== prevSessionId) {
      logger.info(`${logPrefix} Session ID: ${sessionState.sessionId}`);
      if (sessionState.sessionId) callbacks.onSessionIdUpdate(sessionState.sessionId);
    }
    if (sessionState.checkpointId !== prevCheckpointId) {
      logger.info(`${logPrefix} Checkpoint ID: ${sessionState.checkpointId}`);
      if (sessionState.checkpointId) callbacks.onCheckpointIdUpdate(sessionState.checkpointId);
    }

    if (json.type === 'system' && (json.subtype === 'error' || json.error)) {
      logger.error({ systemError: json }, `${logPrefix} System error`);
    }

    if (displayOutput) {
      callbacks.onOutputBufferAppend(displayOutput);
      callbacks.onOutput(displayOutput);
    }
  } catch {
    // NOTE: Filter non-JSON output (e.g., chcp command output on Windows)
    if (isNoiseLine(line)) {
      logger.info(`${logPrefix} Filtered non-JSON output: ${line.trim().substring(0, 100)}`);
      return;
    }
    logger.info(`${logPrefix} Raw output: ${line.substring(0, 200)}`);
    if (!shouldHideRawCliLine(line)) {
      const displayLine = line.length > 240 ? `${line.slice(0, 237)}...` : line;
      callbacks.onOutputBufferAppend(displayLine + '\n');
      callbacks.onOutput(displayLine + '\n');
    }
  }
}
