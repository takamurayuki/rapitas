/**
 * サブエージェント制御システム
 * 複数のClaude Code CLIインスタンスを管理し、タスクを分散実行する
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type {
  SubAgentState,
  ParallelExecutionStatus,
  AgentMessage,
  AgentMessageType,
  ExecutionLogEntry,
  ParallelExecutionConfig,
} from './types';
import type { AgentTask, AgentExecutionResult } from '../agents/base-agent';

/**
 * サブエージェントの設定
 */
type SubAgentConfig = {
  agentId: string;
  taskId: number;
  executionId: number;
  workingDirectory: string;
  timeout: number;
  dangerouslySkipPermissions: boolean;
};

/**
 * サブエージェントインスタンス
 */
class SubAgent extends EventEmitter {
  readonly config: SubAgentConfig;
  private process: ChildProcess | null = null;
  private state: SubAgentState;
  private outputBuffer: string = '';
  private claudeSessionId: string | null = null;

  constructor(config: SubAgentConfig) {
    super();
    this.config = config;
    this.state = {
      agentId: config.agentId,
      taskId: config.taskId,
      executionId: config.executionId,
      status: 'pending',
      startedAt: new Date(),
      lastActivityAt: new Date(),
      output: '',
      artifacts: [],
      tokensUsed: 0,
      executionTimeMs: 0,
    };
  }

  /**
   * タスクを実行
   */
  async execute(task: AgentTask): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    this.state.status = 'running';
    this.state.startedAt = new Date();

    return new Promise((resolve, reject) => {
      try {
        // Claude Code CLIコマンドを構築
        const args = this.buildClaudeArgs(task);

        console.log(`[SubAgent ${this.config.agentId}] Starting with args:`, args.join(' '));

        // プロセスを起動
        this.process = spawn('claude', args, {
          cwd: this.config.workingDirectory,
          shell: true,
          env: {
            ...process.env,
            FORCE_COLOR: '0', // カラーコードを無効化
          },
        });

        // タイムアウト設定
        const timeout = setTimeout(() => {
          if (this.process) {
            this.process.kill('SIGTERM');
            reject(new Error(`Task execution timed out after ${this.config.timeout}ms`));
          }
        }, this.config.timeout);

        // 標準出力の処理
        this.process.stdout?.on('data', (data) => {
          const chunk = data.toString();
          this.outputBuffer += chunk;
          this.state.output += chunk;
          this.state.lastActivityAt = new Date();

          // セッションIDを抽出
          this.extractSessionId(chunk);

          // 出力をイベントで通知
          this.emit('output', chunk, false);
        });

        // 標準エラー出力の処理
        this.process.stderr?.on('data', (data) => {
          const chunk = data.toString();
          this.outputBuffer += chunk;
          this.state.output += chunk;
          this.state.lastActivityAt = new Date();
          this.emit('output', chunk, true);
        });

        // プロセス終了時の処理
        this.process.on('close', (code) => {
          clearTimeout(timeout);
          this.state.executionTimeMs = Date.now() - startTime;

          if (code === 0) {
            this.state.status = 'completed';
            resolve({
              success: true,
              output: this.state.output,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
              claudeSessionId: this.claudeSessionId || undefined,
            });
          } else {
            this.state.status = 'failed';
            resolve({
              success: false,
              output: this.state.output,
              errorMessage: `Process exited with code ${code}`,
              tokensUsed: this.state.tokensUsed,
              executionTimeMs: this.state.executionTimeMs,
            });
          }
        });

        // エラーハンドリング
        this.process.on('error', (error) => {
          clearTimeout(timeout);
          this.state.status = 'failed';
          this.state.executionTimeMs = Date.now() - startTime;
          reject(error);
        });

      } catch (error) {
        this.state.status = 'failed';
        reject(error);
      }
    });
  }

  /**
   * Claude Code CLIの引数を構築
   */
  private buildClaudeArgs(task: AgentTask): string[] {
    const args: string[] = [];

    // 非対話モード
    args.push('--print');

    // JSON出力
    args.push('--output-format', 'stream-json');

    // 権限スキップ
    if (this.config.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // プロンプトを追加
    const prompt = this.buildPrompt(task);
    args.push(prompt);

    return args;
  }

  /**
   * プロンプトを構築
   */
  private buildPrompt(task: AgentTask): string {
    let prompt = '';

    if (task.title) {
      prompt += `# タスク: ${task.title}\n\n`;
    }

    if (task.description) {
      prompt += task.description + '\n';
    }

    // 並列実行に関する注意を追加
    prompt += `
## 並列実行時の注意事項
このタスクは他のタスクと並列で実行されている可能性があります。
以下の点に注意してください：
- ファイルの編集が他のタスクと競合しないよう注意
- 共有リソースへのアクセスは最小限に
- 進捗状況を明確に出力すること
`;

    return prompt;
  }

  /**
   * セッションIDを抽出
   */
  private extractSessionId(output: string): void {
    // JSON出力からセッションIDを抽出
    try {
      const lines = output.split('\n').filter(line => line.trim());
      for (const line of lines) {
        if (line.startsWith('{')) {
          const json = JSON.parse(line);
          if (json.session_id) {
            this.claudeSessionId = json.session_id;
          }
        }
      }
    } catch {
      // JSONパースエラーは無視
    }
  }

  /**
   * 実行を停止
   */
  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.state.status = 'cancelled';
    }
  }

  /**
   * 状態を取得
   */
  getState(): SubAgentState {
    return { ...this.state };
  }

  /**
   * ステータスを取得
   */
  getStatus(): ParallelExecutionStatus {
    return this.state.status;
  }
}

/**
 * サブエージェントコントローラー
 */
export class SubAgentController extends EventEmitter {
  private agents: Map<string, SubAgent> = new Map();
  private config: ParallelExecutionConfig;
  private messageQueue: AgentMessage[] = [];
  private isProcessingMessages: boolean = false;

  constructor(config: ParallelExecutionConfig) {
    super();
    this.config = config;
  }

  /**
   * 新しいサブエージェントを作成
   */
  createAgent(
    taskId: number,
    executionId: number,
    workingDirectory: string
  ): string {
    const agentId = `agent-${taskId}-${Date.now()}`;

    const agent = new SubAgent({
      agentId,
      taskId,
      executionId,
      workingDirectory,
      timeout: this.config.taskTimeoutSeconds * 1000,
      dangerouslySkipPermissions: true,
    });

    // 出力イベントをフォワード
    agent.on('output', (chunk: string, isError: boolean) => {
      this.emit('agent_output', {
        agentId,
        taskId,
        executionId,
        chunk,
        isError,
        timestamp: new Date(),
      });

      // ログ共有が有効な場合、他のエージェントに通知
      if (this.config.logSharing) {
        this.broadcastMessage({
          id: `msg-${Date.now()}`,
          timestamp: new Date(),
          fromAgentId: agentId,
          toAgentId: 'broadcast',
          type: 'task_progress',
          payload: {
            taskId,
            chunk: chunk.slice(0, 500), // 長すぎるログは切り詰め
          },
        });
      }
    });

    this.agents.set(agentId, agent);

    console.log(`[SubAgentController] Created agent ${agentId} for task ${taskId}`);

    return agentId;
  }

  /**
   * エージェントでタスクを実行
   */
  async executeTask(agentId: string, task: AgentTask): Promise<AgentExecutionResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    // タスク開始を通知
    this.emit('task_started', {
      agentId,
      taskId: task.id,
      timestamp: new Date(),
    });

    this.broadcastMessage({
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId: agentId,
      toAgentId: 'broadcast',
      type: 'task_started',
      payload: { taskId: task.id, title: task.title },
    });

    try {
      const result = await agent.execute(task);

      // タスク完了を通知
      this.emit(result.success ? 'task_completed' : 'task_failed', {
        agentId,
        taskId: task.id,
        result,
        timestamp: new Date(),
      });

      this.broadcastMessage({
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
        fromAgentId: agentId,
        toAgentId: 'broadcast',
        type: result.success ? 'task_completed' : 'task_failed',
        payload: {
          taskId: task.id,
          success: result.success,
          executionTimeMs: result.executionTimeMs,
        },
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.emit('task_failed', {
        agentId,
        taskId: task.id,
        error: errorMessage,
        timestamp: new Date(),
      });

      this.broadcastMessage({
        id: `msg-${Date.now()}`,
        timestamp: new Date(),
        fromAgentId: agentId,
        toAgentId: 'broadcast',
        type: 'task_failed',
        payload: { taskId: task.id, error: errorMessage },
      });

      return {
        success: false,
        output: '',
        errorMessage,
      };
    }
  }

  /**
   * エージェントを停止
   */
  stopAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      console.log(`[SubAgentController] Stopped agent ${agentId}`);
    }
  }

  /**
   * すべてのエージェントを停止
   */
  stopAllAgents(): void {
    for (const [agentId, agent] of this.agents) {
      agent.stop();
    }
    this.agents.clear();
    console.log('[SubAgentController] Stopped all agents');
  }

  /**
   * エージェントの状態を取得
   */
  getAgentState(agentId: string): SubAgentState | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.getState() : null;
  }

  /**
   * すべてのエージェントの状態を取得
   */
  getAllAgentStates(): Map<string, SubAgentState> {
    const states = new Map<string, SubAgentState>();
    for (const [agentId, agent] of this.agents) {
      states.set(agentId, agent.getState());
    }
    return states;
  }

  /**
   * アクティブなエージェント数を取得
   */
  getActiveAgentCount(): number {
    let count = 0;
    for (const agent of this.agents.values()) {
      if (agent.getStatus() === 'running') {
        count++;
      }
    }
    return count;
  }

  /**
   * メッセージをブロードキャスト
   */
  broadcastMessage(message: AgentMessage): void {
    if (!this.config.coordinationEnabled) return;

    this.messageQueue.push(message);
    this.processMessageQueue();

    this.emit('message', message);
  }

  /**
   * 特定のエージェントにメッセージを送信
   */
  sendMessage(toAgentId: string, fromAgentId: string, type: AgentMessageType, payload: unknown): void {
    if (!this.config.coordinationEnabled) return;

    const message: AgentMessage = {
      id: `msg-${Date.now()}`,
      timestamp: new Date(),
      fromAgentId,
      toAgentId,
      type,
      payload,
    };

    this.messageQueue.push(message);
    this.processMessageQueue();

    this.emit('message', message);
  }

  /**
   * メッセージキューを処理
   */
  private async processMessageQueue(): Promise<void> {
    if (this.isProcessingMessages || this.messageQueue.length === 0) return;

    this.isProcessingMessages = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()!;

      // メッセージをログに記録
      this.logMessage(message);
    }

    this.isProcessingMessages = false;
  }

  /**
   * メッセージをログに記録
   */
  private logMessage(message: AgentMessage): void {
    const entry: ExecutionLogEntry = {
      timestamp: message.timestamp,
      agentId: message.fromAgentId,
      taskId: 0, // メッセージからタスクIDを取得
      level: 'info',
      message: `[${message.type}] ${JSON.stringify(message.payload).slice(0, 200)}`,
      metadata: {
        messageId: message.id,
        toAgentId: message.toAgentId,
        type: message.type,
      },
    };

    this.emit('log', entry);
  }

  /**
   * エージェントを削除
   */
  removeAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.stop();
      this.agents.delete(agentId);
      console.log(`[SubAgentController] Removed agent ${agentId}`);
    }
  }

  /**
   * 実行中のタスクIDを取得
   */
  getRunningTaskIds(): number[] {
    const taskIds: number[] = [];
    for (const agent of this.agents.values()) {
      if (agent.getStatus() === 'running') {
        taskIds.push(agent.config.taskId);
      }
    }
    return taskIds;
  }
}

/**
 * サブエージェントコントローラーのファクトリー関数
 */
export function createSubAgentController(config: ParallelExecutionConfig): SubAgentController {
  return new SubAgentController(config);
}
