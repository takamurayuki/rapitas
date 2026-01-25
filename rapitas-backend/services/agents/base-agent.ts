/**
 * AIエージェント抽象基底クラス
 * 将来的に他のエージェント（Codex, Gemini等）を追加できるよう設計
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

export type AgentStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'waiting_for_input';

export type AgentTask = {
  id: number;
  title: string;
  description?: string | null;
  context?: string;
  workingDirectory?: string;
  repositoryUrl?: string;
};

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

export abstract class BaseAgent {
  protected status: AgentStatus = 'idle';
  protected outputHandler?: AgentOutputHandler;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: string
  ) {}

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
