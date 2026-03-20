/**
 * Output Parser Worker
 *
 * Dedicated Worker thread entry point for output parsing.
 * Manages worker state (lineBuffer, activeTools) and routes incoming messages
 * to handlers in output-parser-handlers.ts.
 * Parsing logic lives in output-parser-parsers.ts.
 */

declare var self: Worker;

import { processLine, type ToolInfo } from './output-parser-handlers';
import { parseArtifacts, parseCommits } from './output-parser-parsers';

// ==================== Worker internal state ====================

let lineBuffer = '';
const activeTools = new Map<string, ToolInfo>();
let config: { logPrefix?: string; timeoutSeconds: number } = { timeoutSeconds: 300 };

// ==================== Message protocol ====================

// Input message types
type WorkerInputMessage =
  | { type: 'configure'; config: { logPrefix?: string; timeoutSeconds: number } }
  | { type: 'parse-chunk'; data: string }
  | { type: 'parse-complete'; outputBuffer: string }
  | { type: 'terminate' };

// ==================== postResult helper ====================

/**
 * Sends a message from this worker to the main thread.
 *
 * @param msg - Message payload / メッセージペイロード
 */
function postResult(msg: Record<string, unknown>): void {
  self.postMessage(msg);
}

// ==================== Main message handler ====================

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  const msg = event.data;

  try {
    switch (msg.type) {
      case 'configure':
        config = msg.config;
        break;

      case 'parse-chunk': {
        // Add chunks to buffer and process complete lines
        lineBuffer += msg.data;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || ''; // Keep last incomplete line

        for (const line of lines) {
          processLine(line, activeTools, config, postResult);
        }
        break;
      }

      case 'parse-complete': {
        // Flush remaining buffer
        if (lineBuffer.trim()) {
          processLine(lineBuffer, activeTools, config, postResult);
        }

        // Parse artifacts and commits from outputBuffer
        const artifacts = msg.outputBuffer ? parseArtifacts(msg.outputBuffer) : [];
        const commits = msg.outputBuffer ? parseCommits(msg.outputBuffer) : [];

        if (artifacts.length > 0) {
          postResult({
            type: 'artifacts-parsed',
            data: { artifacts },
          });
        }
        if (commits.length > 0) {
          postResult({
            type: 'commits-parsed',
            data: { commits },
          });
        }

        postResult({
          type: 'parse-complete',
          remainingBuffer: lineBuffer,
        });
        lineBuffer = '';
        activeTools.clear();
        break;
      }

      case 'terminate':
        // Worker termination (stopped by worker.terminate() from main thread)
        lineBuffer = '';
        activeTools.clear();
        // NOTE: self.close() does not exist in Bun Worker; use process.exit instead
        process.exit(0);
        break;
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    postResult({
      type: 'error',
      message: err.message,
      stack: err.stack,
    });
  }
};
