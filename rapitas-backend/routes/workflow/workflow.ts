/**
 * Workflow Routes
 * AIエージェントのワークフローファイル（research.md, question.md, plan.md, verify.md）を管理するAPI
 */
import { Elysia } from 'elysia';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../../config';
import { NotFoundError, ValidationError, parseId } from '../../middleware/error-handler';
import { sanitizeMarkdownContent } from '../../utils/mojibake-detector';
import {
  analyzeTaskComplexity,
  getWorkflowModeConfig,
  type TaskComplexityInput,
} from '../../services/workflow/complexity-analyzer';
import { AgentOrchestrator } from '../../services/agents/agent-orchestrator';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:workflow');

const VALID_FILE_TYPES = ['research', 'question', 'plan', 'verify'] as const;
type WorkflowFileType = (typeof VALID_FILE_TYPES)[number];

const VALID_WORKFLOW_STATUSES = [
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
  'completed',
] as const;

/**
 * タスクIDからワークフローディレクトリのパスを解決する
 * Task → Theme → Category の関連をたどってID取得
 */
async function resolveWorkflowDir(taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { include: { category: true } } },
  });

  if (!task) return null;

  const categoryId = task.theme?.categoryId ?? null;
  const themeId = task.themeId ?? null;

  const categoryDir = categoryId !== null ? String(categoryId) : '0';
  const themeDir = themeId !== null ? String(themeId) : '0';

  return {
    task,
    dir: join(process.cwd(), 'tasks', categoryDir, themeDir, String(taskId)),
    categoryId,
    themeId,
  };
}

/**
 * ファイルの情報を取得する
 */
async function getFileInfo(filePath: string, fileType: WorkflowFileType) {
  try {
    const content = await readFile(filePath, 'utf-8');
    const stats = await stat(filePath);
    return {
      type: fileType,
      exists: true,
      content,
      lastModified: stats.mtime.toISOString(),
      size: stats.size,
    };
  } catch {
    return {
      type: fileType,
      exists: false,
    };
  }
}

/**
 * verify.md保存後の自動コミット・PR作成処理
 */
async function performAutoCommitAndPR(taskId: number, verifyContent: string) {
  const result: {
    autoCommitResult?: {
      success: boolean;
      hash?: string;
      branch?: string;
      filesChanged?: number;
      error?: string;
    };
    autoPRResult?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
    autoMergeResult?: { success: boolean; mergeStrategy?: string; error?: string };
  } = {};

  try {
    // AgentExecutionConfigを取得してautoCommit/autoCreatePRの設定を確認
    const execConfig = await prisma.agentExecutionConfig.findUnique({
      where: { taskId },
    });

    if (
      !execConfig ||
      (!execConfig.autoCommit && !execConfig.autoCreatePR && !execConfig.autoMergePR)
    ) {
      return result;
    }

    // タスクとworkingDirectoryの情報を取得
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
        developerModeConfig: {
          include: {
            agentSessions: {
              orderBy: { lastActivityAt: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    if (!task) return result;

    // workingDirectoryを解決: AgentExecutionConfig → theme → cwd
    const workingDirectory =
      execConfig.workingDirectory || task.theme?.workingDirectory || process.cwd();

    // ブランチ名をAgentSessionから取得
    const latestSession = task.developerModeConfig?.agentSessions?.[0];
    const branchName = latestSession?.branchName;

    // ターゲットブランチを解決: execConfig.targetBranch → theme.defaultBranch → 'master'
    const targetBranch =
      ((execConfig as Record<string, unknown>).targetBranch as string) ||
      task.theme?.defaultBranch ||
      'master';

    const orchestrator = AgentOrchestrator.getInstance(prisma);

    // autoCommitの処理
    if (execConfig.autoCommit) {
      try {
        // ブランチが設定されている場合はチェックアウト
        if (branchName) {
          await orchestrator.createBranch(workingDirectory, branchName);
        }

        const commitMessage = `feat(task-${taskId}): ${task.title}`;
        const commitResult = await orchestrator.createCommit(workingDirectory, commitMessage);
        result.autoCommitResult = {
          success: true,
          hash: commitResult.hash,
          branch: commitResult.branch,
          filesChanged: commitResult.filesChanged,
        };

        log.info(`[Workflow] Auto-commit successful for task ${taskId}: ${commitResult.hash}`);

        // ActivityLogに記録
        await prisma.activityLog.create({
          data: {
            taskId,
            action: 'auto_commit_created',
            metadata: JSON.stringify({
              hash: commitResult.hash,
              branch: commitResult.branch,
              filesChanged: commitResult.filesChanged,
              additions: commitResult.additions,
              deletions: commitResult.deletions,
            }),
            createdAt: new Date(),
          },
        });
      } catch (commitError) {
        log.error({ err: commitError }, `[Workflow] Auto-commit failed for task ${taskId}`);
        result.autoCommitResult = {
          success: false,
          error: commitError instanceof Error ? commitError.message : String(commitError),
        };
      }
    }

    // autoCreatePRの処理（autoCommitが成功した場合のみ）
    if (execConfig.autoCreatePR && result.autoCommitResult?.success) {
      try {
        const prTitle = `[Task-${taskId}] ${task.title}`;
        const prBody = `## Summary\n\nAuto-generated PR for Task #${taskId}: ${task.title}\n\n## Verification Report\n\n${verifyContent}\n\n---\n🤖 Generated automatically by Rapitas AI Agent`;

        const prResult = await orchestrator.createPullRequest(
          workingDirectory,
          prTitle,
          prBody,
          targetBranch,
        );

        result.autoPRResult = prResult;

        if (prResult.success) {
          log.info(`[Workflow] Auto-PR created for task ${taskId}: ${prResult.prUrl}`);

          // ActivityLogに記録
          await prisma.activityLog.create({
            data: {
              taskId,
              action: 'auto_pr_created',
              metadata: JSON.stringify({
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
              }),
              createdAt: new Date(),
            },
          });

          // 通知を作成
          await prisma.notification.create({
            data: {
              type: 'auto_pr_created',
              title: '自動PR作成完了',
              message: `タスク「${task.title}」のPRが自動作成されました: ${prResult.prUrl}`,
              link: prResult.prUrl || `/tasks/${taskId}`,
              metadata: JSON.stringify({
                taskId,
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
              }),
            },
          });
        } else {
          log.error(
            { error: prResult.error },
            `[Workflow] Auto-PR creation failed for task ${taskId}`,
          );
        }
      } catch (prError) {
        log.error({ err: prError }, `[Workflow] Auto-PR failed for task ${taskId}`);
        result.autoPRResult = {
          success: false,
          error: prError instanceof Error ? prError.message : String(prError),
        };
      }
    }

    // autoMergePRの処理（autoCreatePRが成功した場合のみ）
    if (execConfig.autoMergePR && result.autoPRResult?.success && result.autoPRResult?.prNumber) {
      try {
        const mergeResult = await orchestrator.mergePullRequest(
          workingDirectory,
          result.autoPRResult.prNumber,
          execConfig.mergeCommitThreshold ?? 5,
          targetBranch,
        );

        result.autoMergeResult = mergeResult;

        if (mergeResult.success) {
          log.info(
            `[Workflow] Auto-merge successful for task ${taskId}: strategy=${mergeResult.mergeStrategy}`,
          );

          // ActivityLogに記録
          await prisma.activityLog.create({
            data: {
              taskId,
              action: 'auto_pr_merged',
              metadata: JSON.stringify({
                prNumber: result.autoPRResult.prNumber,
                prUrl: result.autoPRResult.prUrl,
                mergeStrategy: mergeResult.mergeStrategy,
              }),
              createdAt: new Date(),
            },
          });

          // 通知を作成
          await prisma.notification.create({
            data: {
              type: 'auto_pr_merged',
              title: '自動マージ完了',
              message: `タスク「${task.title}」のPRが自動マージされました (${mergeResult.mergeStrategy})`,
              link: result.autoPRResult.prUrl || `/tasks/${taskId}`,
              metadata: JSON.stringify({
                taskId,
                prNumber: result.autoPRResult.prNumber,
                mergeStrategy: mergeResult.mergeStrategy,
              }),
            },
          });
        } else {
          log.error(
            { error: mergeResult.error },
            `[Workflow] Auto-merge failed for task ${taskId}`,
          );

          // 失敗通知（ワークフロー全体は失敗させない）
          await prisma.notification.create({
            data: {
              type: 'auto_pr_merge_failed',
              title: '自動マージ失敗',
              message: `タスク「${task.title}」のPR自動マージに失敗しました: ${mergeResult.error}`,
              link: result.autoPRResult.prUrl || `/tasks/${taskId}`,
              metadata: JSON.stringify({
                taskId,
                prNumber: result.autoPRResult.prNumber,
                error: mergeResult.error,
              }),
            },
          });
        }
      } catch (mergeError) {
        log.error({ err: mergeError }, `[Workflow] Auto-merge failed for task ${taskId}`);
        result.autoMergeResult = {
          success: false,
          error: mergeError instanceof Error ? mergeError.message : String(mergeError),
        };
      }
    }
  } catch (error) {
    log.error({ err: error }, `[Workflow] Auto-commit/PR process failed for task ${taskId}`);
  }

  return result;
}

export const workflowRoutes = new Elysia({ prefix: '/workflow' })

  // ワークフローファイル一覧取得
  .get('/tasks/:taskId/files', async ({ params, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const resolved = await resolveWorkflowDir(taskId);
      if (!resolved) {
        throw new NotFoundError('Task not found');
      }

      const { task, dir, categoryId, themeId } = resolved;

      // 4ファイルの情報を並列取得
      const [research, question, plan, verify] = await Promise.all(
        VALID_FILE_TYPES.map((type) => getFileInfo(join(dir, `${type}.md`), type)),
      );

      return {
        research,
        question,
        plan,
        verify,
        workflowStatus: task.workflowStatus || null,
        path: {
          taskId,
          categoryId,
          themeId,
          dir: `tasks/${categoryId ?? 0}/${themeId ?? 0}/${taskId}`,
        },
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error fetching workflow files');
      throw err;
    }
  })

  // ワークフローファイル保存
  .put('/tasks/:taskId/files/:fileType', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const fileType = params.fileType as WorkflowFileType;
      if (!VALID_FILE_TYPES.includes(fileType)) {
        throw new ValidationError(
          `Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}`,
        );
      }

      const resolved = await resolveWorkflowDir(taskId);
      if (!resolved) {
        throw new NotFoundError('Task not found');
      }

      const { dir } = resolved;
      const parsedBody = body as { content: string };
      if (!parsedBody?.content && parsedBody?.content !== '') {
        throw new ValidationError('content is required');
      }

      // ディレクトリ作成（再帰的）
      await mkdir(dir, { recursive: true });

      // 文字化け検出・修正処理
      const sanitizeResult = sanitizeMarkdownContent(parsedBody.content);
      const mojibakeFixed = sanitizeResult.wasFixed;
      if (sanitizeResult.wasFixed) {
        log.info(
          { issues: sanitizeResult.issues },
          `[Workflow API] Fixed mojibake in ${fileType}.md for task ${taskId}`,
        );
      }

      // ファイル書き込み
      const filePath = join(dir, `${fileType}.md`);
      await writeFile(filePath, sanitizeResult.content, 'utf-8');

      // workflowStatus の自動更新
      let newStatus: string | undefined;
      const currentStatus = resolved.task.workflowStatus;

      log.info(`[Workflow] Processing fileType: ${fileType}, currentStatus: ${currentStatus}`);

      if (fileType === 'research' && (!currentStatus || currentStatus === 'draft')) {
        log.info(`[Workflow] Research completed: setting newStatus to research_done`);
        newStatus = 'research_done';
      } else if (fileType === 'plan' && (!currentStatus || currentStatus === 'research_done')) {
        newStatus = 'plan_created';
      } else if (fileType === 'verify') {
        log.info(
          `[Workflow] Processing verify.md for task ${taskId}, currentStatus: ${currentStatus}`,
        );
        log.info(`[Workflow] Unconditionally setting newStatus to completed`);
        newStatus = 'completed';
      }

      log.info(`[Workflow] newStatus after condition checks: ${newStatus}`);

      if (newStatus) {
        log.info(`[Workflow] Updating workflowStatus to: ${newStatus}`);
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: newStatus, updatedAt: new Date() },
        });
        log.info(`[Workflow] workflowStatus updated successfully`);
      } else {
        log.info(`[Workflow] newStatus is falsy, skipping workflowStatus update`);
      }

      // plan.md保存時、autoApprovePlanが有効なら自動承認
      let autoApproved = false;
      if (fileType === 'plan' && newStatus === 'plan_created') {
        const userSettings = await prisma.userSettings.findFirst();
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          select: { autoApprovePlan: true, parentId: true },
        });

        // サブタスク判定
        const isSubtask = task?.parentId !== null && task?.parentId !== undefined;

        // タスクレベル / グローバル / サブタスク自動承認のいずれかがtrueなら自動承認
        const shouldAutoApprove =
          task?.autoApprovePlan ||
          userSettings?.autoApprovePlan ||
          (isSubtask && (userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan);

        if (shouldAutoApprove) {
          // 自動承認: plan_approved に遷移
          await prisma.task.update({
            where: { id: taskId },
            data: { workflowStatus: 'plan_approved', updatedAt: new Date() },
          });
          newStatus = 'plan_approved';
          autoApproved = true;

          // ActivityLog に自動承認を記録
          const approvalReason = task?.autoApprovePlan
            ? 'task-level autoApprovePlan setting enabled'
            : isSubtask && (userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan
              ? 'subtask autoApproveSubtaskPlan setting enabled'
              : 'global autoApprovePlan setting enabled';

          await prisma.activityLog.create({
            data: {
              taskId,
              action: 'plan_auto_approved',
              metadata: JSON.stringify({
                previousStatus: 'plan_created',
                newStatus: 'plan_approved',
                reason: approvalReason,
                taskLevelSetting: task?.autoApprovePlan || false,
                globalLevelSetting: userSettings?.autoApprovePlan || false,
                subtaskAutoApprove:
                  isSubtask && !!(userSettings as Record<string, unknown>)?.autoApproveSubtaskPlan,
                isSubtask,
              }),
              createdAt: new Date(),
            },
          });

          // 自動的に実装フェーズを開始
          try {
            const { WorkflowOrchestrator } =
              await import('../../services/workflow/workflow-orchestrator');
            const orchestrator = WorkflowOrchestrator.getInstance();
            orchestrator
              .advanceWorkflow(taskId)
              .then((result) => {
                log.info(
                  `[Workflow] Auto-advance after auto-approval for task ${taskId}: ${result.success ? 'success' : result.error}`,
                );
              })
              .catch((err) => {
                log.error(
                  { err: err },
                  `[Workflow] Auto-advance after auto-approval failed for task ${taskId}`,
                );
              });
          } catch (err) {
            log.error({ err: err }, '[Workflow] Failed to auto-advance after auto-approval');
          }
        }
      }

      // verify.md保存時の自動コミット・PR作成
      let autoCommitPRResult: Awaited<ReturnType<typeof performAutoCommitAndPR>> = {};
      if (fileType === 'verify' && newStatus === 'completed') {
        autoCommitPRResult = await performAutoCommitAndPR(taskId, sanitizeResult.content);
      }

      // レスポンス構築
      const response: {
        success: boolean;
        fileType: string;
        path: string;
        workflowStatus: string | null;
        autoApproved: boolean;
        taskCompleted?: boolean;
        taskStatus?: string;
        completedAt?: string;
        autoCommit?: {
          success: boolean;
          hash?: string;
          branch?: string;
          filesChanged?: number;
          error?: string;
        };
        autoPR?: { success: boolean; prUrl?: string; prNumber?: number; error?: string };
        autoMerge?: { success: boolean; mergeStrategy?: string; error?: string };
      } = {
        success: true,
        fileType,
        path: filePath,
        workflowStatus: newStatus || currentStatus,
        autoApproved,
      };

      // verify.mdファイル保存で完了した場合の追加情報
      if (fileType === 'verify' && newStatus === 'completed') {
        response.taskCompleted = true;
        response.taskStatus = 'done';
        response.completedAt = new Date().toISOString();

        // 自動コミット・PR結果を含める
        if (autoCommitPRResult.autoCommitResult) {
          response.autoCommit = autoCommitPRResult.autoCommitResult;
        }
        if (autoCommitPRResult.autoPRResult) {
          response.autoPR = autoCommitPRResult.autoPRResult;
        }
        if (autoCommitPRResult.autoMergeResult) {
          response.autoMerge = autoCommitPRResult.autoMergeResult;
        }
      }

      return response;
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error saving workflow file');
      throw err;
    }
  })

  // プラン承認
  .post('/tasks/:taskId/approve-plan', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const parsedBody = body as { approved: boolean; reason?: string };
      if (typeof parsedBody?.approved !== 'boolean') {
        throw new ValidationError('approved (boolean) is required');
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      let newStatus: string;
      if (parsedBody.approved) {
        // 承認 → plan_approved に移行（次に実装者エージェントを実行可能）
        newStatus = 'plan_approved';
      } else {
        // 却下 → plan_created に戻す
        newStatus = 'plan_created';
      }

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: newStatus, updatedAt: new Date() },
      });

      // ActivityLog に記録
      await prisma.activityLog.create({
        data: {
          taskId,
          action: parsedBody.approved ? 'plan_approved' : 'plan_rejected',
          metadata: JSON.stringify({
            reason: parsedBody.reason,
            previousStatus: task.workflowStatus,
            newStatus,
          }),
          createdAt: new Date(),
        },
      });

      // 承認された場合、自動的に実装フェーズを開始する
      if (parsedBody.approved) {
        try {
          // オーケストラキュー内のタスクであれば、キュー経由で再開
          const { AIOrchestra } = await import('../../services/workflow/ai-orchestra');
          AIOrchestra.getInstance()
            .handlePlanApproved(taskId)
            .catch((err) => {
              log.warn(
                { err },
                `[Workflow] Orchestra resume failed for task ${taskId}, falling back to direct advance`,
              );
            });

          const { WorkflowOrchestrator } =
            await import('../../services/workflow/workflow-orchestrator');
          const orchestrator = WorkflowOrchestrator.getInstance();
          // 非同期で実装フェーズを開始（レスポンスを待たない）
          orchestrator
            .advanceWorkflow(taskId)
            .then((result) => {
              log.info(
                `[Workflow] Auto-advance after approval for task ${taskId}: ${result.success ? 'success' : result.error}`,
              );
            })
            .catch((err) => {
              log.error(
                { err: err },
                `[Workflow] Auto-advance after approval failed for task ${taskId}`,
              );
            });
        } catch (err) {
          log.error({ err: err }, '[Workflow] Failed to auto-advance after approval');
        }
      }

      return {
        success: true,
        task: updatedTask,
        workflowStatus: newStatus,
        autoAdvance: parsedBody.approved, // フロントエンドにauto-advanceが開始されたことを通知
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error approving plan');
      throw err;
    }
  })

  // ワークフローステータス更新
  .put('/tasks/:taskId/status', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const parsedBody = body as { status: string };
      if (
        !parsedBody?.status ||
        !(VALID_WORKFLOW_STATUSES as readonly string[]).includes(parsedBody.status)
      ) {
        throw new ValidationError(
          `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}`,
        );
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: { workflowStatus: parsedBody.status, updatedAt: new Date() },
      });

      // ActivityLog に記録
      await prisma.activityLog.create({
        data: {
          taskId,
          action: 'workflow_status_updated',
          metadata: JSON.stringify({
            previousStatus: task.workflowStatus,
            newStatus: parsedBody.status,
          }),
          createdAt: new Date(),
        },
      });

      return {
        success: true,
        task: updatedTask,
        workflowStatus: parsedBody.status,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error updating workflow status');
      throw err;
    }
  })

  // ワークフローの次のフェーズを実行
  .post('/workflow/tasks/:taskId/advance', async ({ params, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const { WorkflowOrchestrator } =
        await import('../../services/workflow/workflow-orchestrator');
      const orchestrator = WorkflowOrchestrator.getInstance();

      // 非同期で実行開始（結果を待たずにレスポンスを返す）
      const resultPromise = orchestrator.advanceWorkflow(taskId);

      // ただし、即座に失敗する場合（バリデーションエラー等）は同期的にエラーを返す
      // 100ms待ってエラーが出ていないか確認
      const quickResult = await Promise.race([
        resultPromise,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
      ]);

      if (quickResult !== null) {
        // 即座に完了（APIエージェントの場合）またはバリデーションエラー
        if (!quickResult.success) {
          set.status = 400;
        }
        return quickResult;
      }

      // CLIエージェントなど時間のかかる実行はバックグラウンドで続行
      resultPromise
        .then(async (result) => {
          log.info(
            `[Workflow] Advance completed for task ${taskId}: ${result.success ? 'success' : result.error}`,
          );
        })
        .catch((err) => {
          log.error({ err: err }, `[Workflow] Advance failed for task ${taskId}`);
        });

      return {
        success: true,
        message: 'ワークフローフェーズの実行を開始しました',
        taskId,
        async: true,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error advancing workflow');
      throw err;
    }
  })

  // ワークフローモード手動設定
  .post('/tasks/:taskId/set-mode', async ({ params, body, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const parsedBody = body as {
        mode: 'lightweight' | 'standard' | 'comprehensive';
        override?: boolean;
      };
      const validModes = ['lightweight', 'standard', 'comprehensive'];

      if (!parsedBody?.mode || !validModes.includes(parsedBody.mode)) {
        throw new ValidationError(`Invalid mode. Must be one of: ${validModes.join(', ')}`);
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        throw new NotFoundError('Task not found');
      }

      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          workflowMode: parsedBody.mode,
          workflowModeOverride: parsedBody.override ?? true,
          updatedAt: new Date(),
        },
      });

      // ActivityLog に記録
      await prisma.activityLog.create({
        data: {
          taskId,
          action: 'workflow_mode_changed',
          metadata: JSON.stringify({
            previousMode: task.workflowMode,
            newMode: parsedBody.mode,
            isOverride: parsedBody.override ?? true,
          }),
          createdAt: new Date(),
        },
      });

      return {
        success: true,
        taskId,
        workflowMode: parsedBody.mode,
        override: parsedBody.override ?? true,
        task: updatedTask,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error setting workflow mode');
      throw err;
    }
  })

  // タスク複雑度自動分析
  .get('/tasks/:taskId/analyze-complexity', async ({ params, set }) => {
    try {
      const taskId = parseId(params.taskId, 'task ID');

      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: {
          theme: true,
          taskLabels: {
            include: { label: true },
          },
        },
      });

      if (!task) {
        throw new NotFoundError('Task not found');
      }

      // TaskComplexityInput を構築
      const complexityInput: TaskComplexityInput = {
        title: task.title,
        description: task.description,
        estimatedHours: task.estimatedHours,
        labels: task.taskLabels.map((tl) => tl.label.name),
        priority: task.priority,
        themeId: task.themeId,
      };

      // 複雑度分析を実行
      const analysisResult = analyzeTaskComplexity(complexityInput);

      // 結果をデータベースに保存（複雑度スコアとワークフローモード）
      const updatedTask = await prisma.task.update({
        where: { id: taskId },
        data: {
          complexityScore: analysisResult.complexityScore,
          workflowMode: task.workflowModeOverride
            ? task.workflowMode
            : analysisResult.recommendedMode,
          updatedAt: new Date(),
        },
      });

      return {
        success: true,
        taskId,
        analysis: analysisResult,
        appliedMode: updatedTask.workflowMode,
        wasOverridden: !!task.workflowModeOverride,
      };
    } catch (err) {
      if (err instanceof ValidationError || err instanceof NotFoundError) throw err;
      log.error({ err: err }, 'Error analyzing task complexity');
      throw err;
    }
  })

  // 利用可能なワークフローモード一覧取得
  .get('/modes', async ({ set }) => {
    try {
      const modeConfig = getWorkflowModeConfig();

      return {
        success: true,
        modes: modeConfig,
        defaultMode: 'comprehensive',
      };
    } catch (err) {
      log.error({ err: err }, 'Error fetching workflow modes');
      throw err;
    }
  });
