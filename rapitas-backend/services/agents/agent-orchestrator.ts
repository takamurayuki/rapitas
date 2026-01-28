/**
 * エージェントオーケストレーター
 * エージェントの実行管理、状態追跡、イベント配信を担当
 */
// import { PrismaClient } from "@prisma/client";
import { exec } from "child_process";
import { promisify } from "util";
import { agentFactory } from "./agent-factory";
import type { AgentConfigInput } from "./agent-factory";
import type {
  AgentTask,
  AgentExecutionResult,
  AgentOutputHandler,
  AgentStatus,
  TaskAnalysisInfo,
} from "./base-agent";

const execAsync = promisify(exec);

export type ExecutionOptions = {
  taskId: number;
  sessionId: number;
  agentConfigId?: number;
  workingDirectory?: string;
  timeout?: number;
  requireApproval?: boolean;
  onOutput?: AgentOutputHandler;
  /** AIタスク分析結果（有効な場合に渡される） */
  analysisInfo?: TaskAnalysisInfo;
};

export type ExecutionState = {
  executionId: number;
  sessionId: number;
  agentId: string;
  taskId: number;
  status: AgentStatus;
  startedAt: Date;
  output: string;
};

export type OrchestratorEvent = {
  type:
    | "execution_started"
    | "execution_output"
    | "execution_completed"
    | "execution_failed"
    | "execution_cancelled";
  executionId: number;
  sessionId: number;
  taskId: number;
  data?: unknown;
  timestamp: Date;
};

export type EventListener = (event: OrchestratorEvent) => void;

/**
 * エージェントオーケストレータークラス
 */
export class AgentOrchestrator {
  private static instance: AgentOrchestrator;
  private prisma: any;
  private activeExecutions: Map<number, ExecutionState> = new Map();
  private eventListeners: Set<EventListener> = new Set();

  private constructor(prisma: any) {
    this.prisma = prisma;
  }

  static getInstance(prisma: any): AgentOrchestrator {
    if (!AgentOrchestrator.instance) {
      AgentOrchestrator.instance = new AgentOrchestrator(prisma);
    }
    return AgentOrchestrator.instance;
  }

  /**
   * イベントリスナーを追加
   */
  addEventListener(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * イベントリスナーを削除
   */
  removeEventListener(listener: EventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * イベントを発火
   */
  private emitEvent(event: OrchestratorEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("Error in event listener:", error);
      }
    }
  }

  /**
   * タスクを実行
   */
  async executeTask(
    task: AgentTask,
    options: ExecutionOptions,
  ): Promise<AgentExecutionResult> {
    // エージェント設定を取得
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory: options.workingDirectory,
      timeout: options.timeout,
      dangerouslySkipPermissions: true, // 自動実行モード: ファイル変更を許可
    };

    if (options.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: options.agentConfigId },
      });
      if (dbConfig) {
        agentConfig = {
          type: dbConfig.agentType as "claude-code",
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          modelId: dbConfig.modelId || undefined,
          workingDirectory: options.workingDirectory,
          timeout: options.timeout,
          dangerouslySkipPermissions: true, // 自動実行モード: 常に有効
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // 実行レコードを作成
    const execution = await this.prisma.agentExecution.create({
      data: {
        sessionId: options.sessionId,
        agentConfigId: options.agentConfigId,
        command: task.description || task.title,
        status: "pending",
      },
    });

    // 実行状態を追跡
    const state: ExecutionState = {
      executionId: execution.id,
      sessionId: options.sessionId,
      agentId: agent.id,
      taskId: options.taskId,
      status: "idle",
      startedAt: new Date(),
      output: "",
    };
    this.activeExecutions.set(execution.id, state);

    // 出力ハンドラを設定（リアルタイムでDBに保存）
    let lastDbUpdate = Date.now();
    const DB_UPDATE_INTERVAL = 200; // 0.2秒ごとにDBを更新（リアルタイム表示のため）
    let pendingDbUpdate = false;

    agent.setOutputHandler(async (output, isError) => {
      state.output += output;
      if (options.onOutput) {
        options.onOutput(output, isError);
      }

      // イベントを発火（リアルタイム通知用）
      this.emitEvent({
        type: "execution_output",
        executionId: execution.id,
        sessionId: options.sessionId,
        taskId: options.taskId,
        data: { output, isError },
        timestamp: new Date(),
      });

      // 定期的にDBを更新（ポーリング用）
      const now = Date.now();
      if (now - lastDbUpdate > DB_UPDATE_INTERVAL && !pendingDbUpdate) {
        pendingDbUpdate = true;
        lastDbUpdate = now;
        try {
          await this.prisma.agentExecution.update({
            where: { id: execution.id },
            data: { output: state.output },
          });
        } catch (e) {
          console.error("Failed to update execution output:", e);
        } finally {
          pendingDbUpdate = false;
        }
      }
    });

    // 実行開始イベント
    this.emitEvent({
      type: "execution_started",
      executionId: execution.id,
      sessionId: options.sessionId,
      taskId: options.taskId,
      timestamp: new Date(),
    });

    // 初期メッセージを設定
    const initialMessage = `[実行開始] タスクの実行を開始します...\n`;
    state.output = initialMessage;

    // 実行レコードを更新（初期出力も保存）
    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "running",
        startedAt: new Date(),
        output: initialMessage,
      },
    });

    try {
      // AIタスク分析結果がある場合はタスクに追加
      const taskWithAnalysis: AgentTask = {
        ...task,
        analysisInfo: options.analysisInfo,
      };

      // 分析情報の有無をログ出力
      if (options.analysisInfo) {
        console.log(`[Orchestrator] AI task analysis enabled`);
        console.log(`[Orchestrator] Analysis summary: ${options.analysisInfo.summary?.substring(0, 100)}`);
        console.log(`[Orchestrator] Subtasks count: ${options.analysisInfo.subtasks?.length || 0}`);
      } else {
        console.log(`[Orchestrator] AI task analysis not provided`);
      }

      // エージェントを実行
      const result = await agent.execute(taskWithAnalysis);

      console.log(
        `[Orchestrator] Execution result - success: ${result.success}, waitingForInput: ${result.waitingForInput}, questionType: ${result.questionType}, question: ${result.question?.substring(0, 100)}`,
      );

      // ステータス判定: 質問待ちの場合は waiting_for_input
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input" as any;
        console.log(`[Orchestrator] Setting status to waiting_for_input`);
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
        console.log(`[Orchestrator] Setting status to completed`);
      } else {
        executionStatus = "failed";
        state.status = "failed";
        console.log(`[Orchestrator] Setting status to failed`);
      }

      // 実行レコードを更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: result.output,
          artifacts: result.artifacts
            ? JSON.parse(JSON.stringify(result.artifacts))
            : null,
          completedAt: result.waitingForInput ? null : new Date(),
          tokensUsed: result.tokensUsed || 0,
          executionTimeMs: result.executionTimeMs,
          errorMessage: result.errorMessage,
          question: result.question || null,
          questionType: result.questionType || null,
          questionDetails: result.questionDetails
            ? JSON.parse(JSON.stringify(result.questionDetails))
            : null,
          // 新しい構造化キー情報（questionKeyフィールドがDBに追加されたら有効化）
          // questionKey: result.questionKey
          //   ? JSON.parse(JSON.stringify(result.questionKey))
          //   : null,
        },
      });

      // セッションのトークン使用量を更新
      if (result.tokensUsed) {
        await this.prisma.agentSession.update({
          where: { id: options.sessionId },
          data: {
            totalTokensUsed: {
              increment: result.tokensUsed,
            },
            lastActivityAt: new Date(),
          },
        });
      }

      // Gitコミットを記録
      if (result.commits && result.commits.length > 0) {
        for (const commit of result.commits) {
          await this.prisma.gitCommit.create({
            data: {
              executionId: execution.id,
              commitHash: commit.hash,
              message: commit.message,
              branch: commit.branch,
              filesChanged: commit.filesChanged,
              additions: commit.additions,
              deletions: commit.deletions,
            },
          });
        }
      }

      // イベント発火
      if (result.waitingForInput) {
        // 質問待ちイベント（新しい構造化キー情報を含む）
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: options.sessionId,
          taskId: options.taskId,
          data: {
            output: result.output,
            waitingForInput: true,
            question: result.question,
            questionType: result.questionType,
            questionDetails: result.questionDetails,
            questionKey: result.questionKey, // 新しい構造化キー情報
          },
          timestamp: new Date(),
        });
      } else {
        // 完了イベント
        this.emitEvent({
          type: result.success ? "execution_completed" : "execution_failed",
          executionId: execution.id,
          sessionId: options.sessionId,
          taskId: options.taskId,
          data: result,
          timestamp: new Date(),
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      state.status = "failed";

      // エラー時の更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: state.output,
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.emitEvent({
        type: "execution_failed",
        executionId: execution.id,
        sessionId: options.sessionId,
        taskId: options.taskId,
        data: { errorMessage },
        timestamp: new Date(),
      });

      throw error;
    } finally {
      // クリーンアップ
      this.activeExecutions.delete(execution.id);
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 会話を継続（質問への回答）
   */
  async executeContinuation(
    executionId: number,
    response: string,
    options: Partial<ExecutionOptions> = {},
  ): Promise<AgentExecutionResult> {
    // 既存の実行を取得
    const execution = await this.prisma.agentExecution.findUnique({
      where: { id: executionId },
      include: {
        session: {
          include: {
            config: {
              include: {
                task: true,
              },
            },
          },
        },
      },
    });

    if (!execution) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (execution.status !== "waiting_for_input") {
      throw new Error(
        `Execution is not waiting for input: ${execution.status}`,
      );
    }

    // タスク情報を取得
    const task = execution.session.config?.task;

    // エージェント設定を取得
    let agentConfig: AgentConfigInput = {
      type: "claude-code",
      name: "Claude Code Agent",
      workingDirectory: task?.workingDirectory || undefined,
      timeout: options.timeout,
      dangerouslySkipPermissions: true,
      continueConversation: true, // 前回の会話を継続
    };

    if (execution.agentConfigId) {
      const dbConfig = await this.prisma.aIAgentConfig.findUnique({
        where: { id: execution.agentConfigId },
      });
      if (dbConfig) {
        agentConfig = {
          type: dbConfig.agentType as "claude-code",
          name: dbConfig.name,
          endpoint: dbConfig.endpoint || undefined,
          modelId: dbConfig.modelId || undefined,
          workingDirectory: task?.workingDirectory || undefined,
          timeout: options.timeout,
          dangerouslySkipPermissions: true,
          continueConversation: true, // 前回の会話を継続
        };
      }
    }

    // エージェントを作成
    const agent = agentFactory.createAgent(agentConfig);

    // タスクIDを取得
    const taskId = execution.session.config?.taskId || 0;

    // 実行状態を追跡
    const state: ExecutionState = {
      executionId: execution.id,
      sessionId: execution.sessionId,
      agentId: agent.id,
      taskId,
      status: "running",
      startedAt: new Date(),
      output: execution.output || "",
    };
    this.activeExecutions.set(execution.id, state);

    // 出力ハンドラを設定
    let lastDbUpdate = Date.now();
    const DB_UPDATE_INTERVAL = 200; // 0.2秒ごとにDBを更新
    let pendingDbUpdate = false;

    agent.setOutputHandler(async (output, isError) => {
      state.output += output;
      if (options.onOutput) {
        options.onOutput(output, isError);
      }

      this.emitEvent({
        type: "execution_output",
        executionId: execution.id,
        sessionId: execution.sessionId,
        taskId,
        data: { output, isError },
        timestamp: new Date(),
      });

      const now = Date.now();
      if (now - lastDbUpdate > DB_UPDATE_INTERVAL && !pendingDbUpdate) {
        pendingDbUpdate = true;
        lastDbUpdate = now;
        try {
          await this.prisma.agentExecution.update({
            where: { id: execution.id },
            data: { output: state.output },
          });
        } catch (e) {
          console.error("Failed to update execution output:", e);
        } finally {
          pendingDbUpdate = false;
        }
      }
    });

    // 継続メッセージを追加
    const continueMessage = `\n[継続] ユーザーからの回答を受け取りました。実行を継続します...\n`;
    state.output += continueMessage;

    // 実行レコードを更新（再開）
    await this.prisma.agentExecution.update({
      where: { id: execution.id },
      data: {
        status: "running",
        question: null, // 質問をクリア
        output: state.output,
      },
    });

    try {
      // タスクを作成（回答をプロンプトとして使用）
      const agentTask: AgentTask = {
        id: taskId,
        title: response,
        description: response,
        workingDirectory: task?.workingDirectory || undefined,
      };

      // エージェントを実行
      const result = await agent.execute(agentTask);

      // ステータス判定
      let executionStatus: string;
      if (result.waitingForInput) {
        executionStatus = "waiting_for_input";
        state.status = "waiting_for_input" as any;
      } else if (result.success) {
        executionStatus = "completed";
        state.status = "completed";
      } else {
        executionStatus = "failed";
        state.status = "failed";
      }

      // 実行レコードを更新
      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: executionStatus,
          output: state.output + "\n" + result.output,
          artifacts: result.artifacts
            ? JSON.parse(JSON.stringify(result.artifacts))
            : execution.artifacts,
          completedAt: result.waitingForInput ? null : new Date(),
          tokensUsed: (execution.tokensUsed || 0) + (result.tokensUsed || 0),
          executionTimeMs:
            (execution.executionTimeMs || 0) + (result.executionTimeMs || 0),
          errorMessage: result.errorMessage,
          question: result.question || null,
          questionType: result.questionType || null,
          questionDetails: result.questionDetails
            ? JSON.parse(JSON.stringify(result.questionDetails))
            : null,
          // 新しい構造化キー情報（questionKeyフィールドがDBに追加されたら有効化）
          // questionKey: result.questionKey
          //   ? JSON.parse(JSON.stringify(result.questionKey))
          //   : null,
        },
      });

      // セッションのトークン使用量を更新
      if (result.tokensUsed) {
        await this.prisma.agentSession.update({
          where: { id: execution.sessionId },
          data: {
            totalTokensUsed: {
              increment: result.tokensUsed,
            },
            lastActivityAt: new Date(),
          },
        });
      }

      // Gitコミットを記録
      if (result.commits && result.commits.length > 0) {
        for (const commit of result.commits) {
          await this.prisma.gitCommit.create({
            data: {
              executionId: execution.id,
              commitHash: commit.hash,
              message: commit.message,
              branch: commit.branch,
              filesChanged: commit.filesChanged,
              additions: commit.additions,
              deletions: commit.deletions,
            },
          });
        }
      }

      // イベント発火
      if (result.waitingForInput) {
        this.emitEvent({
          type: "execution_output",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: {
            output: result.output,
            waitingForInput: true,
            question: result.question,
            questionType: result.questionType,
            questionDetails: result.questionDetails,
            questionKey: result.questionKey, // 新しい構造化キー情報
          },
          timestamp: new Date(),
        });
      } else {
        this.emitEvent({
          type: result.success ? "execution_completed" : "execution_failed",
          executionId: execution.id,
          sessionId: execution.sessionId,
          taskId,
          data: result,
          timestamp: new Date(),
        });
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      state.status = "failed";

      await this.prisma.agentExecution.update({
        where: { id: execution.id },
        data: {
          status: "failed",
          output: state.output,
          completedAt: new Date(),
          errorMessage,
        },
      });

      this.emitEvent({
        type: "execution_failed",
        executionId: execution.id,
        sessionId: execution.sessionId,
        taskId,
        data: { errorMessage },
        timestamp: new Date(),
      });

      throw error;
    } finally {
      this.activeExecutions.delete(execution.id);
      await agentFactory.removeAgent(agent.id);
    }
  }

  /**
   * 実行を停止
   */
  async stopExecution(executionId: number): Promise<boolean> {
    const state = this.activeExecutions.get(executionId);
    if (!state) {
      return false;
    }

    const agent = agentFactory.getAgent(state.agentId);
    if (!agent) {
      return false;
    }

    await agent.stop();

    // 実行レコードを更新
    await this.prisma.agentExecution.update({
      where: { id: executionId },
      data: {
        status: "cancelled",
        output: state.output,
        completedAt: new Date(),
      },
    });

    this.emitEvent({
      type: "execution_cancelled",
      executionId,
      sessionId: state.sessionId,
      taskId: state.taskId,
      timestamp: new Date(),
    });

    return true;
  }

  /**
   * アクティブな実行を取得
   */
  getActiveExecutions(): ExecutionState[] {
    return Array.from(this.activeExecutions.values());
  }

  /**
   * 特定のセッションの実行を取得
   */
  getSessionExecutions(sessionId: number): ExecutionState[] {
    return Array.from(this.activeExecutions.values()).filter(
      (state) => state.sessionId === sessionId,
    );
  }

  /**
   * 実行状態を取得
   */
  getExecutionState(executionId: number): ExecutionState | undefined {
    return this.activeExecutions.get(executionId);
  }

  // ==================== Git操作 ====================

  /**
   * 作業ディレクトリのgit diffを取得
   */
  async getGitDiff(workingDirectory: string): Promise<string> {
    try {
      const { stdout } = await execAsync("git diff", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      console.error("Failed to get git diff:", error);
      return "";
    }
  }

  /**
   * ステージされていない変更も含めた全diffを取得
   */
  async getFullGitDiff(workingDirectory: string): Promise<string> {
    try {
      // ステージされた変更
      const { stdout: staged } = await execAsync("git diff --cached", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // ステージされていない変更
      const { stdout: unstaged } = await execAsync("git diff", {
        cwd: workingDirectory,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      });
      // 新規ファイル
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      let result = "";
      if (staged) result += "=== Staged Changes ===\n" + staged + "\n";
      if (unstaged) result += "=== Unstaged Changes ===\n" + unstaged + "\n";
      if (untracked.trim()) result += "=== New Files ===\n" + untracked + "\n";

      return result || "No changes detected";
    } catch (error) {
      console.error("Failed to get full git diff:", error);
      return "";
    }
  }

  /**
   * 変更をコミット
   */
  async commitChanges(
    workingDirectory: string,
    message: string,
    taskTitle?: string,
  ): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    try {
      // すべての変更をステージ
      await execAsync("git add -A", { cwd: workingDirectory });

      // コミットメッセージを作成
      const fullMessage = taskTitle
        ? `${message}\n\nTask: ${taskTitle}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`
        : `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

      // コミット
      const { stdout } = await execAsync(
        `git commit -m "${fullMessage.replace(/"/g, '\\"')}"`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // コミットハッシュを取得
      const { stdout: hash } = await execAsync("git rev-parse HEAD", {
        cwd: workingDirectory,
        encoding: "utf8",
      });

      return { success: true, commitHash: hash.trim() };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * PRを作成
   */
  async createPullRequest(
    workingDirectory: string,
    title: string,
    body: string,
    baseBranch: string = "main",
  ): Promise<{
    success: boolean;
    prUrl?: string;
    prNumber?: number;
    error?: string;
  }> {
    try {
      // ghコマンドのパス
      const ghPath =
        process.platform === "win32"
          ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
          : "gh";

      // 現在のブランチ名を取得
      const { stdout: currentBranch } = await execAsync(
        "git branch --show-current",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // リモートにプッシュ
      await execAsync(`git push -u origin ${currentBranch.trim()}`, {
        cwd: workingDirectory,
      });

      // PR作成
      const { stdout } = await execAsync(
        `${ghPath} pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${baseBranch}`,
        { cwd: workingDirectory, encoding: "utf8" },
      );

      // PR URLからPR番号を抽出
      const prUrl = stdout.trim();
      const prMatch = prUrl.match(/\/pull\/(\d+)/);

      if (!prMatch || !prMatch[1]) {
        return { success: false, error: "Failed to parse PR number from URL" };
      }

      const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

      return { success: true, prUrl, prNumber };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 変更を元に戻す
   */
  async revertChanges(workingDirectory: string): Promise<boolean> {
    try {
      // ステージされた変更を取り消し
      await execAsync("git reset HEAD", { cwd: workingDirectory });
      // 変更を破棄
      await execAsync("git checkout -- .", { cwd: workingDirectory });
      // 新規ファイルを削除
      await execAsync("git clean -fd", { cwd: workingDirectory });
      return true;
    } catch (error) {
      console.error("Failed to revert changes:", error);
      return false;
    }
  }

  /**
   * 新しいブランチを作成してチェックアウト
   */
  async createBranch(
    workingDirectory: string,
    branchName: string,
  ): Promise<boolean> {
    try {
      await execAsync(`git checkout -b ${branchName}`, {
        cwd: workingDirectory,
      });
      return true;
    } catch (error) {
      console.error("Failed to create branch:", error);
      return false;
    }
  }

  /**
   * コミットを作成（フル機能版）
   */
  async createCommit(
    workingDirectory: string,
    message: string,
  ): Promise<{
    hash: string;
    branch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }> {
    // 現在のブランチ名を取得
    const { stdout: currentBranch } = await execAsync(
      "git branch --show-current",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );
    const branch = currentBranch.trim();

    // フィーチャーブランチでない場合は新規作成
    if (branch === "main" || branch === "master" || branch === "develop") {
      const timestamp = Date.now();
      const featureBranch = `feature/auto-${timestamp}`;
      await execAsync(`git checkout -b ${featureBranch}`, {
        cwd: workingDirectory,
      });
    }

    // すべての変更をステージ
    await execAsync("git add -A", { cwd: workingDirectory });

    // 変更統計を取得
    const { stdout: diffStat } = await execAsync(
      "git diff --cached --numstat",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    diffStat
      .split("\n")
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split("\t");
        if (parts.length >= 2) {
          filesChanged++;
          const added = parseInt(parts[0]!, 10) || 0;
          const deleted = parseInt(parts[1]!, 10) || 0;
          additions += added;
          deletions += deleted;
        }
      });

    // コミットメッセージを作成
    const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

    // コミット
    await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: workingDirectory,
      encoding: "utf8",
    });

    // コミットハッシュを取得
    const { stdout: hash } = await execAsync("git rev-parse HEAD", {
      cwd: workingDirectory,
      encoding: "utf8",
    });

    // 最新のブランチ名を取得
    const { stdout: finalBranch } = await execAsync(
      "git branch --show-current",
      {
        cwd: workingDirectory,
        encoding: "utf8",
      },
    );

    return {
      hash: hash.trim(),
      branch: finalBranch.trim(),
      filesChanged,
      additions,
      deletions,
    };
  }

  /**
   * 差分を構造化された形式で取得
   */
  async getDiff(workingDirectory: string): Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>
  > {
    const files: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }> = [];

    try {
      // ステージされた変更
      const { stdout: stagedNumstat } = await execAsync(
        "git diff --cached --numstat",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // ステージされていない変更
      const { stdout: unstagedNumstat } = await execAsync(
        "git diff --numstat",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // 新規ファイル
      const { stdout: untracked } = await execAsync(
        "git ls-files --others --exclude-standard",
        {
          cwd: workingDirectory,
          encoding: "utf8",
        },
      );

      // ステータスを取得
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: workingDirectory,
        encoding: "utf8",
      });

      // ファイル情報をマップに格納
      const fileMap = new Map<
        string,
        {
          additions: number;
          deletions: number;
          status: string;
        }
      >();

      // numstatを解析
      const parseNumstat = (numstat: string) => {
        numstat
          .split("\n")
          .filter(Boolean)
          .forEach((line) => {
            const parts = line.split("\t");
            if (parts.length >= 3) {
              const additions = parseInt(parts[0]!, 10) || 0;
              const deletions = parseInt(parts[1]!, 10) || 0;
              const filename = parts[2]!;
              const existing = fileMap.get(filename);
              fileMap.set(filename, {
                additions: (existing?.additions || 0) + additions,
                deletions: (existing?.deletions || 0) + deletions,
                status: existing?.status || "modified",
              });
            }
          });
      };

      parseNumstat(stagedNumstat);
      parseNumstat(unstagedNumstat);

      // 新規ファイルを追加
      untracked
        .split("\n")
        .filter(Boolean)
        .forEach((filename) => {
          if (!fileMap.has(filename)) {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: "added",
            });
          }
        });

      // ステータスからファイル状態を更新
      status
        .split("\n")
        .filter(Boolean)
        .forEach((line) => {
          const statusCode = line.substring(0, 2);
          const filename = line.substring(3);
          const existing = fileMap.get(filename);
          let fileStatus = "modified";

          if (statusCode.includes("A") || statusCode.includes("?")) {
            fileStatus = "added";
          } else if (statusCode.includes("D")) {
            fileStatus = "deleted";
          } else if (statusCode.includes("R")) {
            fileStatus = "renamed";
          }

          if (existing) {
            existing.status = fileStatus;
          } else {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: fileStatus,
            });
          }
        });

      // 各ファイルのパッチを取得
      for (const [filename, info] of fileMap) {
        let patch = "";
        try {
          if (info.status !== "added") {
            const { stdout: filePatch } = await execAsync(
              `git diff HEAD -- "${filename}"`,
              {
                cwd: workingDirectory,
                encoding: "utf8",
                maxBuffer: 5 * 1024 * 1024,
              },
            );
            patch = filePatch;
          }
        } catch {
          // パッチ取得に失敗した場合は空
        }

        files.push({
          filename,
          status: info.status,
          additions: info.additions,
          deletions: info.deletions,
          patch: patch || undefined,
        });
      }

      return files;
    } catch (error) {
      console.error("Failed to get diff:", error);
      return [];
    }
  }
}

// ファクトリー関数
export function createOrchestrator(prisma: any): AgentOrchestrator {
  return AgentOrchestrator.getInstance(prisma);
}
