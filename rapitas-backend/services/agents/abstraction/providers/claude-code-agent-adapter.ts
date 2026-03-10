/**
 * Claude Code Agent Adapter
 * 既存のClaudeCodeAgentを新しい抽象化レイヤーのIAgentインターフェースに適合させるアダプター
 */

import type {
  AgentState,
  AgentCapabilities,
  AgentMetadata,
  AgentExecutionContext,
  AgentTaskDefinition,
  AgentExecutionResult,
  AgentLifecycleHooks,
  ContinuationContext,
  ClaudeCodeProviderConfig,
  PendingQuestion,
  ExecutionMetrics,
} from '../types';
import type { IAgent } from '../interfaces';
import { AgentEventEmitter, createAgentEventEmitter } from '../event-emitter';
import { AgentError } from '../interfaces';
import { createDefaultCapabilities, generateAgentId } from '../index';
import { ClaudeCodeAgent, ClaudeCodeAgentConfig } from '../../claude-code-agent';
import type { AgentTask, AgentExecutionResult as LegacyExecutionResult } from '../../base-agent';

/**
 * Claude Code Agent Adapter
 * 既存のClaudeCodeAgentを新しいIAgentインターフェースにアダプト
 */
export class ClaudeCodeAgentAdapter implements IAgent {
  private _state: AgentState = 'idle';
  private _metadata: AgentMetadata;
  private _events: AgentEventEmitter;
  private _lifecycleHooks: AgentLifecycleHooks = {};
  private _capabilities: AgentCapabilities;
  private _config: ClaudeCodeProviderConfig;
  private _isDisposed = false;

  // 内部で使用する既存のClaudeCodeAgent
  private _legacyAgent: ClaudeCodeAgent | null = null;
  private _currentSessionId: string | null = null;

  constructor(config: ClaudeCodeProviderConfig) {
    const id = generateAgentId('claude-code');

    this._config = config;
    this._metadata = {
      id,
      providerId: 'claude-code',
      name: `Claude Code Agent (${id})`,
      version: '1.0.0',
      description: 'Claude Code CLI based AI agent',
      createdAt: new Date(),
    };

    this._events = createAgentEventEmitter(id);

    this._capabilities = createDefaultCapabilities({
      codeGeneration: true,
      codeReview: true,
      codeExecution: true,
      fileRead: true,
      fileWrite: true,
      fileEdit: true,
      terminalAccess: true,
      gitOperations: true,
      webSearch: true,
      webFetch: true,
      taskAnalysis: true,
      taskPlanning: true,
      parallelExecution: false,
      questionAsking: true,
      conversationMemory: true,
      sessionContinuation: true,
    });
  }

  // ============================================================================
  // プロパティ
  // ============================================================================

  get metadata(): AgentMetadata {
    return { ...this._metadata };
  }

  get state(): AgentState {
    return this._state;
  }

  get capabilities(): AgentCapabilities {
    return { ...this._capabilities };
  }

  get events(): AgentEventEmitter {
    return this._events;
  }

  // ============================================================================
  // 状態管理
  // ============================================================================

  private async transitionState(newState: AgentState, reason?: string): Promise<void> {
    const previousState = this._state;
    this._state = newState;

    await this._events.emitStateChange(previousState, newState, reason);

    if (this._lifecycleHooks.onStateChange) {
      // コンテキストがない場合はダミーコンテキストを使用
      const dummyContext: AgentExecutionContext = {
        executionId: 'state-change',
        workingDirectory: process.cwd(),
      };
      await this._lifecycleHooks.onStateChange(dummyContext, previousState, newState);
    }
  }

  // ============================================================================
  // 公開メソッド
  // ============================================================================

  /**
   * タスクを実行
   */
  async execute(
    task: AgentTaskDefinition,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    // 実行IDを設定
    this._events.setExecutionId(context.executionId);

    const startTime = new Date();

    try {
      // beforeExecuteフック
      if (this._lifecycleHooks.beforeExecute) {
        const shouldContinue = await this._lifecycleHooks.beforeExecute(context, task);
        if (shouldContinue === false) {
          return this.createCancelledResult(context, 'Cancelled by beforeExecute hook');
        }
      }

      // 状態遷移: idle -> initializing -> running
      await this.transitionState('initializing');

      // 既存のClaudeCodeAgentを作成
      const legacyConfig: ClaudeCodeAgentConfig = {
        workingDirectory: context.workingDirectory,
        timeout: context.timeout || this._config.defaultTimeout || 900000,
        dangerouslySkipPermissions:
          context.dangerouslySkipPermissions || this._config.dangerouslySkipPermissions,
        continueConversation: !!context.sessionId,
        resumeSessionId: context.sessionId,
      };

      this._legacyAgent = new ClaudeCodeAgent(
        `legacy-${this._metadata.id}`,
        this._metadata.name,
        legacyConfig,
      );

      // 出力ハンドラを設定
      this._legacyAgent.setOutputHandler((output: string, isError?: boolean) => {
        this._events.emitOutput(output, isError || false, true);
      });

      // 質問検出ハンドラを設定
      this._legacyAgent.setQuestionDetectedHandler((info) => {
        const question: PendingQuestion = {
          questionId: info.questionKey?.question_id || `q-${Date.now()}`,
          text: info.question,
          category: this.mapQuestionType(info.questionType),
          options: info.questionDetails?.options?.map((opt) => ({
            label: opt.label,
            value: opt.label,
            description: opt.description,
          })),
          multiSelect: info.questionDetails?.multiSelect,
          timeout: context.timeout ? Math.floor(context.timeout / 1000) : 300,
        };
        this._events.emitQuestion(question);
      });

      await this.transitionState('running');

      // レガシータスクを作成
      // task.idがstringの場合は数値に変換（レガシーAPIはnumber型を期待）
      const taskId = typeof task.id === 'string' ? parseInt(task.id, 10) || 0 : task.id;

      const legacyTask: AgentTask = {
        id: taskId,
        title: task.title,
        description: task.description,
        workingDirectory: context.workingDirectory,
        optimizedPrompt: task.optimizedPrompt,
        analysisInfo: task.analysis
          ? {
              summary: task.analysis.summary,
              complexity: task.analysis.complexity,
              estimatedTotalHours: task.analysis.estimatedDuration
                ? task.analysis.estimatedDuration / 60
                : 0,
              subtasks:
                task.analysis.subtasks?.map((st) => ({
                  order: st.order,
                  title: st.title,
                  description: st.description,
                  estimatedHours: st.estimatedDuration ? st.estimatedDuration / 60 : 0,
                  priority: st.priority,
                  dependencies: st.dependencies,
                })) || [],
              reasoning: '',
              tips: task.analysis.tips || [],
            }
          : undefined,
      };

      // タスクを実行
      const legacyResult = await this._legacyAgent.execute(legacyTask);

      // 結果を変換
      const result = this.convertLegacyResult(legacyResult, startTime, context);

      // セッションIDを保存
      if (legacyResult.claudeSessionId) {
        this._currentSessionId = legacyResult.claudeSessionId;
      }

      // 結果に基づいて状態遷移
      if (result.pendingQuestion) {
        await this.transitionState('waiting_for_input');
      } else if (result.success) {
        await this.transitionState('completed');
      } else {
        await this.transitionState('failed');
      }

      // afterExecuteフック
      if (this._lifecycleHooks.afterExecute) {
        await this._lifecycleHooks.afterExecute(context, result);
      }

      // メタデータ更新
      this._metadata.lastUsedAt = new Date();

      return result;
    } catch (error) {
      const agentError = this.wrapError(error);

      // onErrorフック
      if (this._lifecycleHooks.onError) {
        await this._lifecycleHooks.onError(context, agentError, 0);
      }

      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);

      return this.createErrorResult(context, agentError, startTime);
    }
  }

  /**
   * 継続実行（質問への回答後）
   */
  async continue(
    continuation: ContinuationContext,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    this.ensureNotDisposed();

    if (this._state !== 'waiting_for_input') {
      throw new AgentError(
        `Cannot continue execution: agent is in state '${this._state}', expected 'waiting_for_input'`,
        'execution',
        false,
      );
    }

    this._events.setExecutionId(context.executionId);

    const startTime = new Date();

    try {
      await this.transitionState('running');

      // 新しいClaudeCodeAgentを作成（--continueを使用）
      const legacyConfig: ClaudeCodeAgentConfig = {
        workingDirectory: context.workingDirectory,
        timeout: context.timeout || this._config.defaultTimeout || 900000,
        dangerouslySkipPermissions:
          context.dangerouslySkipPermissions || this._config.dangerouslySkipPermissions,
        continueConversation: true,
        resumeSessionId: continuation.sessionId || this._currentSessionId || undefined,
      };

      this._legacyAgent = new ClaudeCodeAgent(
        `legacy-${this._metadata.id}`,
        this._metadata.name,
        legacyConfig,
      );

      // 出力ハンドラを設定
      this._legacyAgent.setOutputHandler((output: string, isError?: boolean) => {
        this._events.emitOutput(output, isError || false, true);
      });

      // ユーザーの回答をタスクとして実行
      // previousExecutionIdがstringの場合は数値に変換
      const taskId =
        typeof continuation.previousExecutionId === 'string'
          ? parseInt(continuation.previousExecutionId, 10) || 0
          : 0;

      const legacyTask: AgentTask = {
        id: taskId,
        title: 'User Response',
        description: continuation.userResponse || '',
        workingDirectory: context.workingDirectory,
      };

      const legacyResult = await this._legacyAgent.execute(legacyTask);
      const result = this.convertLegacyResult(legacyResult, startTime, context);

      // セッションIDを更新
      if (legacyResult.claudeSessionId) {
        this._currentSessionId = legacyResult.claudeSessionId;
      }

      // 結果に基づいて状態遷移
      if (result.pendingQuestion) {
        await this.transitionState('waiting_for_input');
      } else if (result.success) {
        await this.transitionState('completed');
      } else {
        await this.transitionState('failed');
      }

      return result;
    } catch (error) {
      const agentError = this.wrapError(error);
      await this.transitionState('failed');
      await this._events.emitError(agentError, agentError.recoverable);
      return this.createErrorResult(context, agentError, startTime);
    }
  }

  /**
   * 実行を停止
   */
  async stop(): Promise<void> {
    if (this._state === 'idle' || this._state === 'completed' || this._state === 'failed') {
      return;
    }

    if (this._legacyAgent) {
      await this._legacyAgent.stop();
      this._legacyAgent = null;
    }

    await this.transitionState('cancelled');
  }

  /**
   * 実行を一時停止
   */
  async pause(): Promise<boolean> {
    if (this._state !== 'running' || !this._legacyAgent) {
      return false;
    }

    const result = await this._legacyAgent.pause();
    if (result) {
      await this.transitionState('paused');
    }
    return result;
  }

  /**
   * 実行を再開
   */
  async resume(): Promise<boolean> {
    if (this._state !== 'paused' || !this._legacyAgent) {
      return false;
    }

    const result = await this._legacyAgent.resume();
    if (result) {
      await this.transitionState('running');
    }
    return result;
  }

  /**
   * ライフサイクルフックを設定
   */
  setLifecycleHooks(hooks: AgentLifecycleHooks): void {
    this._lifecycleHooks = { ...this._lifecycleHooks, ...hooks };
  }

  /**
   * リソースを解放
   */
  async dispose(): Promise<void> {
    if (this._isDisposed) {
      return;
    }

    // 実行中の場合は停止
    if (this._state === 'running' || this._state === 'waiting_for_input') {
      await this.stop();
    }

    // イベントリスナーを削除
    this._events.removeAllListeners();

    // レガシーエージェントをクリア
    this._legacyAgent = null;

    // 状態をリセット
    this._state = 'idle';
    this._currentSessionId = null;

    this._isDisposed = true;
  }

  // ============================================================================
  // プライベートメソッド
  // ============================================================================

  private ensureNotDisposed(): void {
    if (this._isDisposed) {
      throw new AgentError('Agent has been disposed', 'internal', false);
    }
  }

  private wrapError(error: unknown): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    if (error instanceof Error) {
      return new AgentError(error.message, 'execution', false, undefined, error);
    }

    return new AgentError(String(error), 'internal', false);
  }

  private mapQuestionType(
    legacyType: string,
  ): 'clarification' | 'confirmation' | 'selection' | 'input' {
    switch (legacyType) {
      case 'clarification':
        return 'clarification';
      case 'confirmation':
        return 'confirmation';
      case 'selection':
        return 'selection';
      default:
        return 'input';
    }
  }

  private convertLegacyResult(
    legacyResult: LegacyExecutionResult,
    startTime: Date,
    context: AgentExecutionContext,
  ): AgentExecutionResult {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const metrics: ExecutionMetrics = {
      startTime,
      endTime,
      durationMs,
    };

    // 状態を決定
    let state: AgentState;
    if (legacyResult.waitingForInput) {
      state = 'waiting_for_input';
    } else if (legacyResult.success) {
      state = 'completed';
    } else {
      state = 'failed';
    }

    // 保留中の質問を変換
    let pendingQuestion: PendingQuestion | undefined;
    if (legacyResult.waitingForInput && legacyResult.question) {
      pendingQuestion = {
        questionId: legacyResult.questionKey?.question_id || `q-${Date.now()}`,
        text: legacyResult.question,
        category: this.mapQuestionType(legacyResult.questionType || 'input'),
        options: legacyResult.questionDetails?.options?.map((opt) => ({
          label: opt.label,
          value: opt.label,
          description: opt.description,
        })),
        multiSelect: legacyResult.questionDetails?.multiSelect,
      };
    }

    return {
      success: legacyResult.success,
      state,
      output: legacyResult.output,
      errorMessage: legacyResult.errorMessage,
      artifacts: legacyResult.artifacts?.map((a) => ({
        type: a.type as 'file' | 'code' | 'diff' | 'log' | 'image' | 'data',
        name: a.name,
        content: a.content,
        path: a.path,
      })),
      commits: legacyResult.commits?.map((c) => ({
        hash: c.hash,
        message: c.message,
        branch: c.branch,
        filesChanged: c.filesChanged,
        additions: c.additions,
        deletions: c.deletions,
      })),
      metrics,
      pendingQuestion,
      sessionId: legacyResult.claudeSessionId,
      debugInfo: {
        logs: [],
      },
    };
  }

  private createCancelledResult(
    context: AgentExecutionContext,
    reason: string,
  ): AgentExecutionResult {
    return {
      success: false,
      state: 'cancelled',
      output: '',
      errorMessage: reason,
      debugInfo: {
        logs: [],
      },
    };
  }

  private createErrorResult(
    context: AgentExecutionContext,
    error: AgentError,
    startTime: Date,
  ): AgentExecutionResult {
    const endTime = new Date();

    return {
      success: false,
      state: 'failed',
      output: '',
      errorMessage: error.message,
      metrics: {
        startTime,
        endTime,
        durationMs: endTime.getTime() - startTime.getTime(),
      },
      debugInfo: {
        logs: [],
      },
    };
  }
}
