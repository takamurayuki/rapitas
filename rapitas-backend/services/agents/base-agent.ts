/**
 * BaseAgent
 *
 * Abstract base class for AI agents. Designed for extensibility
 * with additional agent types (Codex, Gemini, etc.).
 */

export type AgentCapability = {
  codeGeneration: boolean;
  codeReview: boolean;
  taskAnalysis: boolean;
  fileOperations: boolean;
  terminalAccess: boolean;
  gitOperations?: boolean;
  webSearch?: boolean;
};

export type AgentStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_for_input';

/**
 * AI task analysis result for structured prompt generation.
 */
export type TaskAnalysisInfo = {
  summary: string;
  complexity: 'simple' | 'medium' | 'complex';
  estimatedTotalHours: number;
  subtasks: Array<{
    title: string;
    description: string;
    estimatedHours: number;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    order: number;
    dependencies?: number[];
  }>;
  reasoning: string;
  tips?: string[];
};

export type AgentTask = {
  id: number;
  title: string;
  description?: string | null;
  context?: string;
  workingDirectory?: string;
  repositoryUrl?: string;
  /** Theme ID this task belongs to. */
  themeId?: number | null;
  /** AI task analysis result (when analysis is enabled). */
  analysisInfo?: TaskAnalysisInfo;
  /** Optimized prompt (structured and optimized by AI). */
  optimizedPrompt?: string;
  /** Claude Code CLI session ID (used with --resume to continue conversation). */
  resumeSessionId?: string;
  /** Model ID override for this task (e.g., "claude-sonnet-4-5-20250514"). */
  modelId?: string;
  /** Whether plan.md should be auto-approved (skips waiting for user approval). */
  autoApprovePlan?: boolean;
};

/**
 * Question type discriminator.
 * - 'tool_call': Question via Claude Code's AskUserQuestion tool call
 * - 'none': No question
 *
 * @deprecated Use QuestionDetectionMethod in new implementations.
 * Question detection now relies solely on AskUserQuestion tool calls.
 */
export type QuestionType = 'tool_call' | 'none';

// QuestionDetails is re-exported from question-detection.ts for backward compatibility

export type AgentExecutionResult = {
  success: boolean;
  output: string;
  artifacts?: AgentArtifact[];
  tokensUsed?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  commits?: GitCommitInfo[];
  waitingForInput?: boolean;
  question?: string;
  /** Question detection method (tool_call: AskUserQuestion tool, none: no question). */
  questionType?: QuestionType;
  /** Question details (options, etc.). */
  questionDetails?: import('./question-detection').QuestionDetails;
  /** Structured question key (new format). */
  questionKey?: import('./question-detection').QuestionKey;
  /** Claude Code CLI session ID (used with --resume to continue conversation). */
  claudeSessionId?: string;
  /** Number of retry attempts before this result. */
  retryCount?: number;
  /** Classified failure reason (for retry decisions). */
  failureType?: 'test_failed' | 'lint_error' | 'type_error' | 'timeout' | 'unknown';
};

export type AgentArtifact = {
  type: 'file' | 'code' | 'diff' | 'log';
  name: string;
  content: string;
  path?: string;
};

export type GitCommitInfo = {
  hash: string;
  message: string;
  branch: string;
  filesChanged: number;
  additions: number;
  deletions: number;
};

export type AgentOutputHandler = (output: string, isError?: boolean) => void;

/**
 * Callback handler invoked immediately when a question is detected during streaming.
 */
export type QuestionDetectedHandler = (info: {
  question: string;
  questionType: QuestionType;
  questionDetails?: import('./question-detection').QuestionDetails;
  questionKey?: import('./question-detection').QuestionKey;
  /** Claude Code CLI session ID (used for resuming). */
  claudeSessionId?: string;
}) => void;

export abstract class BaseAgent {
  protected status: AgentStatus = 'idle';
  protected outputHandler?: AgentOutputHandler;
  protected questionDetectedHandler?: QuestionDetectedHandler;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: string,
  ) {}

  /**
   * Log prefix in [AgentName] format.
   */
  get logPrefix(): string {
    return `[${this.name}]`;
  }

  /**
   * Return the agent's capabilities.
   */
  abstract getCapabilities(): AgentCapability;

  /**
   * Execute a task.
   */
  abstract execute(
    task: AgentTask,
    options?: Record<string, unknown>,
  ): Promise<AgentExecutionResult>;

  /**
   * Stop execution.
   */
  abstract stop(): Promise<void>;

  /**
   * Pause execution (if supported).
   */
  async pause(): Promise<boolean> {
    return false;
  }

  /**
   * Resume execution (if supported).
   */
  async resume(): Promise<boolean> {
    return false;
  }

  /**
   * Get current status.
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Set the output handler.
   */
  setOutputHandler(handler: AgentOutputHandler): void {
    this.outputHandler = handler;
  }

  /**
   * Set the question detection handler.
   * Called immediately when a question is detected during streaming.
   */
  setQuestionDetectedHandler(handler: QuestionDetectedHandler): void {
    this.questionDetectedHandler = handler;
  }

  /**
   * Emit a question detection event.
   */
  protected emitQuestionDetected(info: Parameters<QuestionDetectedHandler>[0]): void {
    if (this.questionDetectedHandler) {
      this.questionDetectedHandler(info);
    }
  }

  /**
   * Emit output.
   */
  protected emitOutput(output: string, isError: boolean = false): void {
    if (this.outputHandler && output != null && output !== 'null' && output !== 'undefined') {
      this.outputHandler(output, isError);
    }
  }

  /**
   * Check whether the agent is available.
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Validate the agent configuration.
   */
  abstract validateConfig(): Promise<{ valid: boolean; errors: string[] }>;
}
