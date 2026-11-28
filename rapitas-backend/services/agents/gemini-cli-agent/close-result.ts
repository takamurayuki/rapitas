/**
 * GeminiCliAgent — Close Result
 *
 * Builds the AgentExecutionResult for a Gemini CLI run once its process has
 * closed (question pause, success or non-zero exit), plus the cancelled and
 * startup-failure results. Moved out of agent.ts (300-line threshold); not
 * responsible for deciding when the run closes.
 */
import type { AgentExecutionResult, AgentStatus } from '../base-agent';
import { tolegacyQuestionType, type QuestionWaitingState } from '../question-detection';
import { parseArtifacts, parseCommits } from './output-parser';

/** Resource figures collected for the closed process. */
type ResourceStats = { cpuTimeMs: number | null; peakRssKb: number | null };

/** Inputs of {@link buildGeminiCloseResult}. */
export interface GeminiCloseInput {
  code: number | null;
  outputBuffer: string;
  errorBuffer: string;
  detectedQuestion: QuestionWaitingState;
  startTime: number;
  /** Checkpoint id (preferred) or session id used to continue the session. */
  sessionId: string | undefined;
  modelName: string | undefined;
  resourceStats: ResourceStats;
}

/**
 * Result and next agent status for a closed run.
 *
 * @param input - Exit code, buffers and session data / 終了コード・バッファ・セッション情報
 * @returns New status and the execution result / 次のステータスと実行結果
 */
export function buildGeminiCloseResult(input: GeminiCloseInput): {
  status: AgentStatus;
  result: AgentExecutionResult;
} {
  const { code, outputBuffer, errorBuffer, detectedQuestion, startTime, resourceStats } = input;
  const artifacts = parseArtifacts(outputBuffer);
  const commits = parseCommits(outputBuffer);
  const { hasQuestion, question, questionKey, questionDetails } = detectedQuestion;

  if (hasQuestion) {
    return {
      status: 'waiting_for_input',
      result: {
        success: true,
        output: outputBuffer,
        artifacts,
        commits,
        executionTimeMs: Date.now() - startTime,
        waitingForInput: true,
        question,
        questionType: tolegacyQuestionType(detectedQuestion.questionType),
        questionDetails,
        questionKey,
        // NOTE: Re-using claudeSessionId field for session continuation (checkpoint ID takes priority)
        claudeSessionId: input.sessionId,
        modelName: input.modelName,
        ...resourceStats,
      },
    };
  }

  let errorMessage: string | undefined;
  if (code !== 0) {
    const parts: string[] = [`プロセスがコード ${code} で終了しました`];
    if (errorBuffer.trim()) parts.push(`\n\n【標準エラー出力】\n${errorBuffer.trim()}`);
    if (outputBuffer.trim()) parts.push(`\n${outputBuffer.trim().slice(-1000)}`);
    errorMessage = parts.join('');
  }

  return {
    status: code === 0 ? 'completed' : 'failed',
    result: {
      success: code === 0,
      output: outputBuffer,
      artifacts,
      commits,
      executionTimeMs: Date.now() - startTime,
      waitingForInput: false,
      claudeSessionId: input.sessionId,
      modelName: input.modelName,
      errorMessage,
      ...resourceStats,
    },
  };
}

/**
 * Result for a run stopped by the user.
 *
 * @param outputBuffer - Output so far / それまでの出力
 * @param startTime - Execution start / 実行開始時刻
 * @param resourceStats - Collected resource figures / 収集したリソース値
 * @returns Cancelled result / 停止結果
 */
export function buildGeminiCancelledResult(
  outputBuffer: string,
  startTime: number,
  resourceStats: ResourceStats,
): AgentExecutionResult {
  return {
    success: false,
    output: outputBuffer,
    errorMessage: 'Execution cancelled',
    executionTimeMs: Date.now() - startTime,
    failureType: 'cancelled',
    ...resourceStats,
  };
}

/**
 * Result for a process that failed to start or errored.
 *
 * @param outputBuffer - Output so far / それまでの出力
 * @param errorBuffer - stderr so far / それまでの標準エラー
 * @param startTime - Execution start / 実行開始時刻
 * @returns Failure result / 失敗結果
 */
export function buildGeminiStartupFailure(
  outputBuffer: string,
  errorBuffer: string,
  startTime: number,
): AgentExecutionResult {
  const parts: string[] = ['プロセス起動エラー'];
  if (errorBuffer.trim()) parts.push(`\n\n【標準エラー出力】\n${errorBuffer.trim()}`);
  return {
    success: false,
    output: outputBuffer,
    errorMessage: parts.join(''),
    executionTimeMs: Date.now() - startTime,
  };
}
