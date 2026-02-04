/**
 * サブエージェント制御システム
 * 複数のClaude Code CLIインスタンスを管理し、タスクを分散実行する
 *
 * 親タスク(claude-code-agent.ts)と同様の方式で実装:
 * - プロンプトをstdinにパイプで渡す
 * - Windows用UTF-8設定 (chcp 65001)
 * - ファイルベースの出力監視でリアルタイムログ取得
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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
 * 出力ログファイルのディレクトリを取得
 */
function getLogDirectory(): string {
  const logDir = join(tmpdir(), 'rapitas-subagent-logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

/**
 * エージェントの出力ログファイルパスを取得
 */
function getLogFilePath(taskId: number, executionId: number): string {
  return join(getLogDirectory(), `task-${taskId}-exec-${executionId}.log`);
}

/**
 * サブエージェントインスタンス
 */
class SubAgent extends EventEmitter {
  readonly config: SubAgentConfig;
  private process: ChildProcess | null = null;
  private state: SubAgentState;
  private outputBuffer: string = '';
  private lineBuffer: string = '';
  private claudeSessionId: string | null = null;
  private logFilePath: string;
  private fileWatchInterval: NodeJS.Timeout | null = null;
  private lastFileSize: number = 0;

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
    // 出力ログファイルパスを設定
    this.logFilePath = getLogFilePath(config.taskId, config.executionId);
  }

  /**
   * 出力ログファイルパスを取得
   */
  getLogFilePath(): string {
    return this.logFilePath;
  }

  /**
   * タスクを実行
   */
  async execute(task: AgentTask): Promise<AgentExecutionResult> {
    const startTime = Date.now();
    this.state.status = 'running';
    this.state.startedAt = new Date();
    this.state.lastActivityAt = new Date();

    // ログファイルを初期化
    writeFileSync(this.logFilePath, `[${new Date().toISOString()}] Task ${this.config.taskId} started\n`);
    console.log(`[SubAgent ${this.config.agentId}] Log file: ${this.logFilePath}`);

    return new Promise((resolve, reject) => {
      let timeoutCheckInterval: NodeJS.Timeout | null = null;
      let isTimedOut = false;
      let hasReceivedAnyOutput = false;

      const cleanup = () => {
        if (timeoutCheckInterval) {
          clearInterval(timeoutCheckInterval);
          timeoutCheckInterval = null;
        }
        if (this.fileWatchInterval) {
          clearInterval(this.fileWatchInterval);
          this.fileWatchInterval = null;
        }
      };

      try {
        // プロンプトを構築
        const prompt = this.buildPrompt(task);

        // Windowsかどうかを判定
        const isWindows = process.platform === 'win32';
        const claudePath = process.env.CLAUDE_CODE_PATH || (isWindows ? 'claude.cmd' : 'claude');

        // コマンドライン引数を構築（プロンプトは含めない、stdinで渡す）
        const args: string[] = [];
        args.push('--print');
        args.push('--verbose');
        args.push('--output-format', 'stream-json');

        // セッション再開の場合は --continue を使用
        if (task.resumeSessionId) {
          args.push('--continue');
          console.log(`[SubAgent ${this.config.agentId}] Continuing session: ${task.resumeSessionId}`);
        }

        if (this.config.dangerouslySkipPermissions) {
          args.push('--dangerously-skip-permissions');
        }

        // Windows用: UTF-8設定を含むコマンドを構築
        let finalCommand: string;
        let finalArgs: string[];

        if (isWindows) {
          const argsString = args.map(arg => {
            if (arg.includes(' ') || arg.includes('&') || arg.includes('|')) {
              return `"${arg}"`;
            }
            return arg;
          }).join(' ');
          finalCommand = `chcp 65001 >nul && ${claudePath} ${argsString}`;
          finalArgs = [];
        } else {
          finalCommand = claudePath;
          finalArgs = args;
        }

        console.log(`[SubAgent ${this.config.agentId}] Command: ${finalCommand}`);
        console.log(`[SubAgent ${this.config.agentId}] Working directory: ${this.config.workingDirectory}`);
        console.log(`[SubAgent ${this.config.agentId}] Prompt length: ${prompt.length} chars`);

        // プロセスを起動（親タスクと同様の設定）
        this.process = spawn(finalCommand, finalArgs, {
          cwd: this.config.workingDirectory,
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            FORCE_COLOR: '0',
            NO_COLOR: '1',
            CI: '1',
            TERM: 'dumb',
            PYTHONUNBUFFERED: '1',
            NODE_OPTIONS: '--no-warnings',
            ...(isWindows && {
              LANG: 'en_US.UTF-8',
              PYTHONIOENCODING: 'utf-8',
              PYTHONUTF8: '1',
              CHCP: '65001',
            }),
          },
        });

        // エンコーディング設定
        if (this.process.stdout) {
          this.process.stdout.setEncoding('utf8');
        }
        if (this.process.stderr) {
          this.process.stderr.setEncoding('utf8');
        }

        console.log(`[SubAgent ${this.config.agentId}] Process spawned with PID: ${this.process.pid}`);

        // stdinにプロンプトを書き込む（親タスクと同様）
        const writePromptToStdin = async () => {
          if (!this.process?.stdin) {
            console.log(`[SubAgent ${this.config.agentId}] stdin is not available`);
            return;
          }

          const stdin = this.process.stdin;
          const CHUNK_SIZE = 16384; // 16KB chunks

          stdin.on('error', (err) => {
            console.error(`[SubAgent ${this.config.agentId}] stdin error:`, err);
          });

          const promptBuffer = Buffer.from(prompt, 'utf8');
          console.log(`[SubAgent ${this.config.agentId}] Writing ${promptBuffer.length} bytes to stdin`);

          for (let i = 0; i < promptBuffer.length; i += CHUNK_SIZE) {
            const chunk = promptBuffer.subarray(i, Math.min(i + CHUNK_SIZE, promptBuffer.length));
            const canContinue = stdin.write(chunk);

            if (!canContinue) {
              await new Promise<void>((resolve) => {
                stdin.once('drain', resolve);
              });
            }
          }

          stdin.end();
          console.log(`[SubAgent ${this.config.agentId}] Prompt written to stdin`);
        };

        writePromptToStdin().catch((err) => {
          console.error(`[SubAgent ${this.config.agentId}] Failed to write prompt:`, err);
        });

        // ファイル監視を開始（500ms間隔）
        this.fileWatchInterval = setInterval(() => {
          this.readNewOutputFromFile();
        }, 500);

        // 最大実行時間ベースのタイムアウトチェック
        const maxExecutionTime = this.config.timeout * 6; // デフォルト5分 → 30分
        timeoutCheckInterval = setInterval(() => {
          const now = Date.now();
          const elapsedTime = now - startTime;

          // 30秒ごとにステータスログを出力
          const idleTime = now - this.state.lastActivityAt.getTime();
          console.log(`[SubAgent ${this.config.agentId}] Status: elapsed=${Math.floor(elapsedTime / 1000)}s, idle=${Math.floor(idleTime / 1000)}s, output=${this.outputBuffer.length} chars`);

          if (elapsedTime > maxExecutionTime) {
            isTimedOut = true;
            cleanup();
            if (this.process) {
              console.log(`[SubAgent ${this.config.agentId}] Max execution time exceeded (${Math.round(elapsedTime / 1000)}s), timing out...`);
              this.appendToLogFile(`\n[TIMEOUT] Max execution time exceeded after ${Math.round(elapsedTime / 1000)}s\n`);
              this.process.kill('SIGTERM');
              reject(new Error(`Task execution timed out after ${Math.round(elapsedTime / 1000)}s (max: ${Math.round(maxExecutionTime / 1000)}s)`));
            }
          }
        }, 30000);

        // 標準出力の処理
        this.process.stdout?.on('data', (data: Buffer | string) => {
          const chunk = data.toString();
          this.lineBuffer += chunk;
          this.state.lastActivityAt = new Date();

          if (!hasReceivedAnyOutput) {
            hasReceivedAnyOutput = true;
            const elapsedMs = Date.now() - startTime;
            console.log(`[SubAgent ${this.config.agentId}] First stdout received after ${elapsedMs}ms`);
          }

          // ファイルに追記
          this.appendToLogFile(chunk);

          // 改行で分割して処理
          const lines = this.lineBuffer.split('\n');
          this.lineBuffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            this.processOutputLine(line);
          }
        });

        // 標準エラー出力の処理
        this.process.stderr?.on('data', (data: Buffer | string) => {
          const chunk = data.toString();
          this.outputBuffer += chunk;
          this.state.output += chunk;
          this.state.lastActivityAt = new Date();

          // ファイルに追記
          this.appendToLogFile(`[STDERR] ${chunk}`);

          // イベント発火
          this.emit('output', chunk, true);
        });

        // プロセス終了時の処理
        this.process.on('close', (code) => {
          cleanup();
          this.state.executionTimeMs = Date.now() - startTime;

          // 最後にファイルから読み取り
          this.readNewOutputFromFile();

          // 終了ログを追記
          this.appendToLogFile(`\n[${new Date().toISOString()}] Process exited with code ${code}\n`);

          if (isTimedOut) return;

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
          cleanup();
          this.state.status = 'failed';
          this.state.executionTimeMs = Date.now() - startTime;
          this.appendToLogFile(`\n[ERROR] ${error.message}\n`);
          reject(error);
        });

      } catch (error) {
        cleanup();
        this.state.status = 'failed';
        reject(error);
      }
    });
  }

  /**
   * ログファイルに追記
   */
  private appendToLogFile(content: string): void {
    try {
      appendFileSync(this.logFilePath, content);
    } catch (error) {
      console.error(`[SubAgent ${this.config.agentId}] Failed to write to log file:`, error);
    }
  }

  /**
   * ログファイルから新しい出力を読み取る
   */
  private readNewOutputFromFile(): void {
    try {
      if (!existsSync(this.logFilePath)) return;

      const stat = statSync(this.logFilePath);
      if (stat.size > this.lastFileSize) {
        const fd = require('fs').openSync(this.logFilePath, 'r');
        const buffer = Buffer.alloc(stat.size - this.lastFileSize);
        require('fs').readSync(fd, buffer, 0, stat.size - this.lastFileSize, this.lastFileSize);
        require('fs').closeSync(fd);

        const newContent = buffer.toString('utf8');
        if (newContent) {
          this.state.lastActivityAt = new Date();
          // 出力イベントを発火（DBに保存用）
          this.emit('output', newContent, false);
        }

        this.lastFileSize = stat.size;
      }
    } catch (error) {
      // ファイル読み取りエラーは無視
    }
  }

  /**
   * 出力行を処理
   */
  private processOutputLine(line: string): void {
    try {
      if (line.startsWith('{')) {
        const json = JSON.parse(line);

        // セッションIDを抽出
        if (json.session_id) {
          this.claudeSessionId = json.session_id;
          console.log(`[SubAgent ${this.config.agentId}] Session ID: ${this.claudeSessionId}`);
        }

        // イベントタイプに応じて出力を生成
        let displayOutput = '';
        switch (json.type) {
          case 'system':
            if (json.subtype === 'init') {
              displayOutput = `[初期化] セッション開始\n`;
            }
            break;
          case 'assistant':
            if (json.message?.content) {
              for (const block of json.message.content) {
                if (block.type === 'text') {
                  displayOutput += block.text;
                } else if (block.type === 'tool_use') {
                  displayOutput += `[ツール使用] ${block.name}\n`;
                }
              }
            }
            break;
          case 'result':
            if (json.result) {
              displayOutput += `\n[結果] ${json.result.substring(0, 500)}${json.result.length > 500 ? '...' : ''}\n`;
            }
            break;
        }

        if (displayOutput) {
          this.outputBuffer += displayOutput;
          this.state.output += displayOutput;
          // 整形された出力をイベントで通知
          this.emit('output', displayOutput, false);
        }
      } else {
        // JSONではない行はそのまま出力
        this.outputBuffer += line + '\n';
        this.state.output += line + '\n';
        this.emit('output', line + '\n', false);
      }
    } catch {
      // JSONパースエラーは無視、生の行を出力
      this.outputBuffer += line + '\n';
      this.state.output += line + '\n';
      this.emit('output', line + '\n', false);
    }
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
   * 実行を停止
   */
  stop(): void {
    if (this.fileWatchInterval) {
      clearInterval(this.fileWatchInterval);
      this.fileWatchInterval = null;
    }
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
            chunk: chunk.slice(0, 500),
          },
        });
      }
    });

    this.agents.set(agentId, agent);

    const logFilePath = agent.getLogFilePath();
    console.log(`[SubAgentController] Created agent ${agentId} for task ${taskId}`);
    console.log(`[SubAgentController] Log file: ${logFilePath}`);

    return agentId;
  }

  /**
   * エージェントのログファイルパスを取得
   */
  getAgentLogFilePath(agentId: string): string | null {
    const agent = this.agents.get(agentId);
    return agent ? agent.getLogFilePath() : null;
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
      taskId: 0,
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
