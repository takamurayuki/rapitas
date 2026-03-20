/**
 * OutputParser
 *
 * Parses line-by-line JSON output from the Claude CLI (`--output-format stream-json`).
 * Tracks active tool calls, detects AskUserQuestion pauses, and accumulates display
 * text. Designed to be owned by SubAgent but isolated here to keep process-manager.ts
 * focused on process lifecycle.
 */
import { createLogger } from '../../../config/logger';
import { formatToolInfo, extractQuestionInfo, type QuestionDetails } from './tool-formatter';

const logger = createLogger('sub-agent-controller');

/** Callbacks invoked by OutputParser when notable events occur. */
export type OutputParserCallbacks = {
  /** Called with formatted display text for any parsed output. */
  onDisplayOutput: (text: string) => void;
  /** Called when a Claude session ID is parsed from the stream. */
  onSessionId: (sessionId: string) => void;
  /** Called when AskUserQuestion tool is detected. */
  onQuestionDetected: (question: string, details?: QuestionDetails) => void;
  /** Called to kill the process (when AskUserQuestion detected). */
  onKillProcess: () => void;
};

/**
 * Stateful parser for Claude CLI stream-json output.
 * One instance per SubAgent execution.
 */
export class OutputParser {
  private activeTools: Map<string, { name: string; startTime: number; info: string }> = new Map();
  private callbacks: OutputParserCallbacks;

  // NOTE: These are read by SubAgent after process exit to determine result type
  public waitingForInput: boolean = false;
  public detectedQuestion: string | null = null;
  public questionDetails: QuestionDetails | null = null;
  public sessionId: string | null = null;

  constructor(callbacks: OutputParserCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Parse a single newline-delimited stdout line from the Claude CLI.
   *
   * @param line - Raw output line / 生の出力行
   * @param agentId - Agent ID for log context / ログ用エージェントID
   */
  parseLine(line: string, agentId: string): void {
    try {
      if (line.startsWith('{')) {
        this.parseJsonLine(JSON.parse(line), agentId);
      } else {
        this.handlePlainLine(line);
      }
    } catch {
      // JSON parse failure: fall through to plain text handling
      this.handlePlainLine(line);
    }
  }

  /** Handle a successfully parsed JSON event from the CLI. */
  private parseJsonLine(json: Record<string, unknown>, agentId: string): void {
    if (json.session_id) {
      this.sessionId = json.session_id as string;
      this.callbacks.onSessionId(this.sessionId);
      logger.info(`[SubAgent ${agentId}] Session ID: ${this.sessionId}`);
    }

    let displayOutput = '';

    switch (json.type) {
      case 'system':
        displayOutput = this.handleSystemEvent(json);
        break;
      case 'assistant':
        displayOutput = this.handleAssistantEvent(json, agentId);
        break;
      case 'user':
        displayOutput = this.handleUserEvent(json);
        break;
      case 'result':
        displayOutput = this.handleResultEvent(json);
        break;
    }

    if (displayOutput) {
      this.callbacks.onDisplayOutput(displayOutput);
    }
  }

  private handleSystemEvent(json: Record<string, unknown>): string {
    if (json.subtype === 'init') return `[System: init]\n`;
    if (json.subtype === 'error') {
      const errorMsg = typeof json.message === 'string' ? json.message : (json.error as string) || 'unknown';
      return `[System Error: ${errorMsg}]\n`;
    }
    return '';
  }

  private handleAssistantEvent(json: Record<string, unknown>, agentId: string): string {
    let displayOutput = '';
    const message = json.message as Record<string, unknown> | undefined;
    if (!message?.content) return '';

    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type === 'text' && block.text) {
        displayOutput += block.text as string;
      } else if (block.type === 'tool_use') {
        displayOutput += this.handleToolUse(block, agentId);
      }
    }
    return displayOutput;
  }

  private handleToolUse(block: Record<string, unknown>, agentId: string): string {
    if (block.name === 'AskUserQuestion') {
      logger.info(`[SubAgent ${agentId}] AskUserQuestion tool detected!`);
      logger.info({ toolInput: block.input }, `[SubAgent ${agentId}] Tool input`);

      const questionInfo = extractQuestionInfo(block.input as Record<string, unknown> | undefined);
      this.waitingForInput = true;
      this.detectedQuestion = questionInfo.questionText;
      this.questionDetails = questionInfo.questionDetails || null;

      this.callbacks.onQuestionDetected(questionInfo.questionText, questionInfo.questionDetails);

      logger.info(`[SubAgent ${agentId}] Stopping process to wait for user response`);
      this.callbacks.onKillProcess();

      return `\n[質問] ${questionInfo.questionText}\n`;
    }

    const toolInfo = formatToolInfo(block.name as string, block.input as Record<string, unknown> | undefined);
    if (block.id) {
      this.activeTools.set(block.id as string, {
        name: block.name as string,
        startTime: Date.now(),
        info: toolInfo,
      });
    }
    return `[Tool: ${block.name}] ${toolInfo}\n`;
  }

  private handleUserEvent(json: Record<string, unknown>): string {
    let displayOutput = '';
    const message = json.message as Record<string, unknown> | undefined;
    if (!message?.content) return '';

    for (const block of message.content as Array<Record<string, unknown>>) {
      if (block.type !== 'tool_result') continue;

      const toolId = block.tool_use_id as string | undefined;
      const activeTool = toolId ? this.activeTools.get(toolId) : undefined;

      if (activeTool) {
        const duration = ((Date.now() - activeTool.startTime) / 1000).toFixed(1);
        displayOutput += block.is_error
          ? `[Tool Error: ${activeTool.name}] (${duration}s)\n`
          : `[Tool Done: ${activeTool.name}] (${duration}s)\n`;
        if (toolId) this.activeTools.delete(toolId);
      } else {
        const toolIdShort = toolId ? `ID: ${toolId.substring(0, 8)}...` : '';
        displayOutput += block.is_error
          ? `[Tool Error ${toolIdShort}]\n`
          : `[Tool Done ${toolIdShort}]\n`;
      }
    }
    return displayOutput;
  }

  private handleResultEvent(json: Record<string, unknown>): string {
    if (!json.result) return '';

    const duration = json.duration_ms
      ? ` (${((json.duration_ms as number) / 1000).toFixed(1)}s)`
      : '';
    const cost = json.cost_usd ? ` $${(json.cost_usd as number).toFixed(4)}` : '';
    let displayOutput = `\n[Result: ${json.subtype || 'completed'}${duration}${cost}]\n`;

    if (typeof json.result === 'string') {
      displayOutput +=
        json.result.substring(0, 500) + (json.result.length > 500 ? '...' : '') + '\n';
    }
    return displayOutput;
  }

  /** Handle a non-JSON stdout line, filtering Windows chcp noise. */
  private handlePlainLine(line: string): void {
    const trimmedLine = line.trim();
    if (
      !trimmedLine ||
      /^Active code page:/i.test(trimmedLine) ||
      /^現在のコード ページ:/i.test(trimmedLine) ||
      /^chcp\s/i.test(trimmedLine)
    ) {
      return;
    }
    this.callbacks.onDisplayOutput(line + '\n');
  }
}
