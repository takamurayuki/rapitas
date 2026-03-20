/**
 * CodexCliAgent — JSON Event Handler
 *
 * Processes individual JSON lines emitted by the Codex CLI `--json` mode.
 * Handles message, user, result, and system event types, mutating shared
 * runner state in place and invoking callbacks for output and questions.
 * Not responsible for process spawning, timeouts, or prompt building.
 */

import {
  detectQuestionFromToolCall,
  updateWaitingStateFromDetection,
  tolegacyQuestionType,
} from '../question-detection';
import { formatToolInfo } from './output-parser';
import { createLogger } from '../../../config/logger';
import type { ProcessRunnerState, ProcessRunnerCallbacks } from './process-runner';
import type { CodexCliAgentConfig } from './types';

const logger = createLogger('codex-cli-agent/json-event-handler');

/**
 * Process a single parsed JSON event object from Codex CLI stdout.
 * Mutates state and invokes callbacks for any display output or question detection.
 *
 * @param json - Parsed JSON event object / パースされたJSONイベントオブジェクト
 * @param state - Shared mutable runner state / 共有される可変ランナー状態
 * @param callbacks - Callbacks into the owning agent / 所有エージェントへのコールバック
 * @param config - Agent configuration for timeout calculation / タイムアウト計算用のエージェント設定
 * @param logPrefix - Log prefix for context-specific logging / ログ出力用プレフィックス
 */
export function processJsonEvent(
  // HACK(agent): eslint disabled — json is truly dynamic per Codex CLI streaming protocol
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: Record<string, any>,
  state: ProcessRunnerState,
  callbacks: ProcessRunnerCallbacks,
  config: CodexCliAgentConfig,
  logPrefix: string,
): void {
  let displayOutput = '';

  switch (json.type) {
    case 'assistant':
    case 'message':
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === 'text' && block.text) {
            displayOutput += block.text;
          } else if (block.type === 'tool_use' || block.type === 'function_call') {
            const toolName = block.name || block.function?.name;
            if (toolName === 'AskUserQuestion' || toolName === 'ask_user') {
              logger.info(`${logPrefix} Question tool detected: ${toolName}`);

              const toolInput = block.input || block.function?.arguments;
              const detectionResult = detectQuestionFromToolCall(
                'AskUserQuestion',
                toolInput,
                config.timeout ? Math.floor(config.timeout / 1000) : undefined,
              );

              state.detectedQuestion = updateWaitingStateFromDetection(detectionResult);
              state.status = 'waiting_for_input';

              callbacks.onStatusChange('waiting_for_input');
              callbacks.onQuestionDetected(state.detectedQuestion);
              callbacks.emitQuestionDetected({
                question: detectionResult.questionText,
                questionType: tolegacyQuestionType(state.detectedQuestion.questionType),
                questionDetails: state.detectedQuestion.questionDetails,
                questionKey: state.detectedQuestion.questionKey,
              });

              displayOutput += `\n[質問] ${detectionResult.questionText}\n`;

              // NOTE: Kill process to wait for user response before continuing
              logger.info(`${logPrefix} Stopping process to wait for user response`);
              if (state.process && !state.process.killed) {
                state.process.kill('SIGTERM');
              }
            } else {
              const toolInfo = formatToolInfo(
                toolName || 'unknown',
                block.input || block.function?.arguments,
              );
              displayOutput += `\n[Tool: ${toolName}] ${toolInfo}\n`;
              if (block.id) {
                state.activeTools.set(block.id, {
                  name: toolName || 'unknown',
                  startTime: Date.now(),
                  info: toolInfo,
                });
              }
            }
          }
        }
      }
      // Handle simple string content format
      if (typeof json.content === 'string') {
        displayOutput += json.content;
      }
      break;

    case 'user':
      if (json.message?.content) {
        for (const block of json.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            const activeTool = state.activeTools.get(block.tool_use_id);
            if (activeTool) {
              const duration = ((Date.now() - activeTool.startTime) / 1000).toFixed(1);
              if (block.is_error) {
                displayOutput += `[Tool Error: ${activeTool.name}] (${duration}s)\n`;
              } else {
                displayOutput += `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
              }
              state.activeTools.delete(block.tool_use_id);
            }
          }
        }
      }
      break;

    case 'result':
      if (json.result) {
        const duration = json.duration_ms ? ` (${(json.duration_ms / 1000).toFixed(1)}s)` : '';
        const cost = json.cost_usd ? ` $${json.cost_usd.toFixed(4)}` : '';
        displayOutput += `\n[Result: ${json.subtype || 'completed'}${duration}${cost}]\n`;
        if (typeof json.result === 'string') {
          displayOutput += json.result + '\n';
        }
      }
      break;

    case 'system':
      if (json.session_id) {
        state.codexSessionId = json.session_id;
        callbacks.onSessionId(json.session_id);
        logger.info(`${logPrefix} Session ID: ${state.codexSessionId}`);
      }

      if (json.subtype === 'error' || json.error) {
        logger.error({ systemError: json }, `${logPrefix} System error`);

        // NOTE: Special handling for gpt-4o model unavailability on ChatGPT accounts
        if (json.error && json.error.includes('gpt-4o') && json.error.includes('ChatGPT account')) {
          displayOutput += `[エラー] ChatGPTアカウントではgpt-4oモデルは使用できません。\n`;
          displayOutput += `[ヒント] 代わりにgpt-4-turboまたはgpt-3.5-turboをお使いください。\n`;
        } else {
          displayOutput += `[System Error: ${json.error || json.subtype || 'unknown'}]\n`;
        }
      } else if (json.subtype !== 'init') {
        displayOutput += `[System: ${json.subtype || 'info'}]\n`;
      }
      break;

    default:
      logger.info(
        { eventType: json.type },
        `${logPrefix} Unknown event type: ${json.type}`,
      );
  }

  if (displayOutput) {
    state.outputBuffer += displayOutput;
    callbacks.emitOutput(displayOutput);
  }
}
