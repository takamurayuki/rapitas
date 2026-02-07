/**
 * AIエージェント抽象基底クラス
 * 将来的に他のエージェント（Codex, Gemini等）を追加できるよう設計
 */

// 質問判定システムの型は各ファイルで直接インポートしてください
// re-exportはBunとの互換性問題があるため削除
// import { QuestionKey, QuestionDetails, ... } from "./question-detection";

export type AgentCapability = {
  codeGeneration: boolean;
  codeReview: boolean;
  taskAnalysis: boolean;
  fileOperations: boolean;
  terminalAccess: boolean;
  gitOperations?: boolean;
  webSearch?: boolean;
};

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'waiting_for_input';

/**
 * AIタスク分析結果（構造化プロンプト用）
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
  /** AIタスク分析が有効な場合の分析結果 */
  analysisInfo?: TaskAnalysisInfo;
  /** 最適化されたプロンプト（AIによる構造化・最適化済み） */
  optimizedPrompt?: string;
  /** Claude Code CLIのセッションID（--resumeで会話を継続するため） */
  resumeSessionId?: string;
};

/**
 * 質問の種類を表す型
 * - 'tool_call': Claude CodeのAskUserQuestionツール呼び出しによる質問
 * - 'none': 質問なし
 *
 * @deprecated 新しい実装ではQuestionDetectionMethodを使用してください
 * 質問検出はAskUserQuestionツール呼び出しのみで行います。
 */
export type QuestionType = 'tool_call' | 'none';

// QuestionDetailsはquestion-detection.tsからre-exportされているため、
// 既存コードの互換性のためにインポートしてローカルでも使用可能

export type AgentExecutionResult = {
  success: boolean;
  output: string;
  artifacts?: AgentArtifact[];
  tokensUsed?: number;
  executionTimeMs?: number;
  errorMessage?: string;
  commits?: GitCommitInfo[];
  // 質問待ち状態
  waitingForInput?: boolean;
  question?: string;
  /** 質問の検出方法（tool_call: AskUserQuestionツール, none: 質問なし） */
  questionType?: QuestionType;
  /** 質問の詳細情報（選択肢など） */
  questionDetails?: import("./question-detection").QuestionDetails;
  /** 構造化キー情報（新方式） */
  questionKey?: import("./question-detection").QuestionKey;
  /** Claude Code CLIのセッションID（--resumeで会話を継続するため） */
  claudeSessionId?: string;
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
 * 質問検出時のコールバックハンドラ
 * ストリーミング中に質問が検出された際に即座に呼び出される
 */
export type QuestionDetectedHandler = (info: {
  question: string;
  questionType: QuestionType;
  questionDetails?: import("./question-detection").QuestionDetails;
  questionKey?: import("./question-detection").QuestionKey;
  /** Claude Code CLIのセッションID（再開時に使用） */
  claudeSessionId?: string;
}) => void;

export abstract class BaseAgent {
  protected status: AgentStatus = 'idle';
  protected outputHandler?: AgentOutputHandler;
  protected questionDetectedHandler?: QuestionDetectedHandler;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: string
  ) {}

  /**
   * ログ出力用のプレフィックス（[エージェント名] 形式）
   */
  get logPrefix(): string {
    return `[${this.name}]`;
  }

  /**
   * エージェントの能力を返す
   */
  abstract getCapabilities(): AgentCapability;

  /**
   * タスクを実行する
   */
  abstract execute(task: AgentTask, options?: Record<string, unknown>): Promise<AgentExecutionResult>;

  /**
   * 実行を停止する
   */
  abstract stop(): Promise<void>;

  /**
   * 実行を一時停止する（対応している場合）
   */
  async pause(): Promise<boolean> {
    return false;
  }

  /**
   * 実行を再開する（対応している場合）
   */
  async resume(): Promise<boolean> {
    return false;
  }

  /**
   * 現在のステータスを取得
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * 出力ハンドラを設定
   */
  setOutputHandler(handler: AgentOutputHandler): void {
    this.outputHandler = handler;
  }

  /**
   * 質問検出ハンドラを設定
   * ストリーミング中に質問が検出された際に即座にコールバックされる
   */
  setQuestionDetectedHandler(handler: QuestionDetectedHandler): void {
    this.questionDetectedHandler = handler;
  }

  /**
   * 質問検出を通知
   */
  protected emitQuestionDetected(info: Parameters<QuestionDetectedHandler>[0]): void {
    if (this.questionDetectedHandler) {
      this.questionDetectedHandler(info);
    }
  }

  /**
   * 出力を送信
   */
  protected emitOutput(output: string, isError: boolean = false): void {
    if (this.outputHandler) {
      this.outputHandler(output, isError);
    }
  }

  /**
   * エージェントが使用可能かどうか
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * 設定を検証する
   */
  abstract validateConfig(): Promise<{ valid: boolean; errors: string[] }>;
}
