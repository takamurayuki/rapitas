/**
 * PromptComparisonCellExecutor
 *
 * Runs ONE current-vs-candidate shadow execution (one sample task, one arm,
 * one knowledge condition) fully outside the production DB-backed execution
 * path: `agentFactory.createAgent()` + `BaseAgent.execute()` are called
 * directly, never `AgentOrchestrator.executeTask()` — so no `AgentExecution`
 * row is ever created and `task-budget.ts`'s cost accounting is never touched
 * (plan.md 設計判断の根拠 — 採用したアプローチ). The isolated worktree is
 * always removed in `finally`, regardless of outcome.
 */
import { agentFactory } from '../../agents/agent-factory';
import { createWorktree } from '../../agents/orchestrator/git-operations/worktree/worktree-create';
import { removeWorktree } from '../../agents/orchestrator/git-operations/worktree/worktree-remove';
import { buildMemoryContext } from '../../workflow/workflow-memory-context';
import { classifyFailureCause } from './prompt-comparison-metrics';
import type { ComparisonArm, ComparisonRun, KnowledgeCondition } from './prompt-comparison-types';
import { createLogger } from '../../../config/logger';

const log = createLogger('self-learning:comparison-cell-executor');

/** Matches the wall-clock budget philosophy of RAPITAS_PHASE_TIMEOUT_MS (production phases), scaled down for a single shadow run. */
export const PROMPT_COMPARISON_CELL_TIMEOUT_MS = 600_000;

export interface RunComparisonCellOptions {
  evolutionId: number;
  sampleTaskId: number;
  arm: ComparisonArm;
  knowledge: KnowledgeCondition;
  modelName: string;
  task: { title: string; description: string | null };
  /** PromptEvolution.afterPrompt — injected only when arm === 'candidate'. */
  candidateAddendum: string;
  worktreeBaseDir: string;
  repositoryUrl: string | null;
  /** Monotonic per-run counter used to keep the synthetic executionId unique within one comparison run. */
  executionSeq: number;
  timeoutMs?: number;
}

/**
 * Negative synthetic id — real `AgentExecution.id` values are always positive
 * (SQLite/Postgres autoincrement), so a negative `ComparisonRun.executionId`
 * can never be mistaken for a foreign key into that table (plan.md データモデル
 * / 状態管理 — `ComparisonRun.executionId`).
 *
 * @param executionSeq - Monotonic counter for this comparison run. / この比較実行内の連番
 * @returns Synthetic negative execution id. / 合成実行ID（負数）
 */
function buildSyntheticExecutionId(executionSeq: number): number {
  return -(Date.now() * 10 + (executionSeq % 10));
}

/**
 * Build the full shadow-run prompt: task title/description, the candidate
 * addendum (candidate arm only), and the shared-knowledge section (with
 * condition only). Set as `AgentTask.optimizedPrompt` so it becomes the
 * agent's entire prompt verbatim (see claude-code/prompt-builder.ts), making
 * the current/candidate and with/without differences directly assertable.
 *
 * @param options - Cell execution options. / セル実行オプション
 * @returns The composed shadow-run prompt. / 組み立て済みプロンプト
 */
async function buildShadowPrompt(options: RunComparisonCellOptions): Promise<string> {
  let prompt = `${options.task.title}\n\n${options.task.description ?? ''}`.trim();
  if (options.arm === 'candidate' && options.candidateAddendum.trim()) {
    prompt += `\n\n## 追加指示(候補プロンプト)\n${options.candidateAddendum.trim()}`;
  }
  if (options.knowledge === 'with') {
    // Negative id: never a real Task row, so this read-only lookup can never
    // resolve to (and thus never reflects) the real sample task's own state.
    const section = await buildMemoryContext(
      -options.sampleTaskId,
      { title: options.task.title, description: options.task.description },
      'ja',
    );
    if (section) prompt += `\n\n${section}`;
  }
  return prompt;
}

/**
 * Run one (sampleTaskId, arm, knowledge) shadow execution in an isolated,
 * disposable git worktree. Never writes to `AgentExecution`/`Task` — the
 * returned `ComparisonRun` is the only record of this execution.
 *
 * @param options - Cell execution options. / セル実行オプション
 * @returns The shadow run's outcome. / 実行結果
 */
export async function runComparisonCell(options: RunComparisonCellOptions): Promise<ComparisonRun> {
  const executionId = buildSyntheticExecutionId(options.executionSeq);
  const startedAt = Date.now();
  const branchName = `shadow-cmp-${options.evolutionId}-${options.sampleTaskId}-${options.arm}-${options.knowledge}-${Math.random().toString(36).slice(2, 8)}`;

  let worktreePath: string | null = null;
  try {
    try {
      worktreePath = await createWorktree(
        options.worktreeBaseDir,
        branchName,
        undefined,
        options.repositoryUrl,
      );
    } catch (err) {
      log.warn(
        { err, sampleTaskId: options.sampleTaskId, arm: options.arm, knowledge: options.knowledge },
        '[comparison-cell] worktree creation failed',
      );
      return {
        taskId: options.sampleTaskId,
        executionId,
        success: false,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
        failureCause: 'infra_failure',
      };
    }

    const prompt = await buildShadowPrompt(options);
    const agent = agentFactory.createAgent({
      type: 'claude-code',
      name: `shadow-cmp-${options.arm}-${options.sampleTaskId}`,
      workingDirectory: worktreePath,
      modelId: options.modelName,
      dangerouslySkipPermissions: true,
    });

    const timeoutMs = options.timeoutMs ?? PROMPT_COMPARISON_CELL_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void agent.stop().catch(() => {});
        reject(new Error('comparison_cell_timeout'));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([
        agent.execute({
          id: -options.sampleTaskId,
          title: options.task.title,
          description: options.task.description ?? undefined,
          optimizedPrompt: prompt,
        }),
        timeoutPromise,
      ]);
      const failureCause = classifyFailureCause({
        status: result.success ? 'completed' : 'failed',
        errorMessage: result.errorMessage ?? null,
      });
      return {
        taskId: options.sampleTaskId,
        executionId,
        success: result.success,
        costUsd: result.costUsd ?? 0,
        durationMs: result.executionTimeMs ?? Date.now() - startedAt,
        failureCause,
      };
    } catch {
      return {
        taskId: options.sampleTaskId,
        executionId,
        success: false,
        costUsd: 0,
        durationMs: Date.now() - startedAt,
        failureCause: 'infra_failure',
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    if (worktreePath) {
      await removeWorktree(options.worktreeBaseDir, worktreePath).catch((err) => {
        log.warn({ err, worktreePath }, '[comparison-cell] worktree removal failed');
      });
    }
  }
}
