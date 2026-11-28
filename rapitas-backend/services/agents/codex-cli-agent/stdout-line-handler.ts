/**
 * CodexCliAgent — Stdout Line Handler
 *
 * Routes one stdout line of the Codex CLI to the JSON event handler or, for
 * non-event text, to the output buffer. Moved unchanged out of
 * process-runner.ts (300-line threshold); not responsible for buffering.
 */
import { createLogger } from '../../../config/logger';
import type { CodexCliAgentConfig } from './types';
import { processJsonEvent } from './json-event-handler';
import { shouldHideRawCliLine } from '../cli-output-filter';
import { parseCodexEventLine } from './codex-event-line';
import type { ProcessRunnerCallbacks, ProcessRunnerState } from './process-runner';

const logger = createLogger('codex-cli-agent/process-runner');

/** Line handler for stdout processing */
export type StdoutLineHandler = (line: string) => void;

/**
 * Create stdout line handler based on mode.
 *
 * @param config - Agent configuration (investigation mode) / エージェント設定
 * @param state - Shared runner state / 実行状態
 * @param callbacks - Agent callbacks / エージェントへのコールバック
 * @returns Handler for one stdout line / stdout 1行のハンドラ
 */
export function createStdoutLineHandler(
  config: CodexCliAgentConfig,
  state: ProcessRunnerState,
  callbacks: ProcessRunnerCallbacks,
): StdoutLineHandler {
  const { logPrefix } = callbacks;

  const appendRawLine = (line: string) => {
    // Investigation mode: keep ALL bytes for post-handler parsing
    if (config.investigationMode) {
      state.outputBuffer += line + '\n';
      callbacks.emitOutput(line + '\n');
      return;
    }
    // Implementation mode: filter and truncate
    if (shouldHideRawCliLine(line)) return;
    const displayLine = line.length > 240 ? `${line.slice(0, 237)}...` : line;
    state.outputBuffer += displayLine + '\n';
    callbacks.emitOutput(displayLine + '\n');
  };

  return (line: string) => {
    if (!line.trim()) return;

    try {
      // Only a typed object is an event; any other line is agent text.
      const event = parseCodexEventLine(line);
      if (!event) throw new Error('not a Codex event');
      logger.info(`${logPrefix} Event: ${event.type}`);
      processJsonEvent(
        event as Parameters<typeof processJsonEvent>[0],
        state,
        callbacks,
        config,
        logPrefix,
      );
    } catch {
      // Filter non-JSON output (e.g., chcp on Windows)
      const trimmed = line.trim();
      if (
        !trimmed ||
        /^Active code page:/i.test(trimmed) ||
        /^現在のコード ページ:/i.test(trimmed) ||
        /^chcp\s/i.test(trimmed)
      ) {
        logger.info(`${logPrefix} Filtered non-JSON: ${trimmed.substring(0, 100)}`);
        return;
      }
      logger.info(`${logPrefix} Raw output: ${line.substring(0, 200)}`);
      appendRawLine(line);
    }
  };
}
