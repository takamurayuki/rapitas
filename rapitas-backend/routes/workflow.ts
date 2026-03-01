/**
 * Workflow Routes
 * AIエージェントのワークフローファイル（research.md, question.md, plan.md, verify.md）を管理するAPI
 */
import { Elysia } from 'elysia';
import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { prisma } from '../config';

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

export const workflowRoutes = new Elysia({ prefix: '/workflow' })

  // ワークフローファイル一覧取得
  .get('/tasks/:taskId/files', async ({ params, set }) => {
    try {
      const taskId = parseInt(params.taskId);
      if (isNaN(taskId)) {
        set.status = 400;
        return { error: 'Invalid task ID' };
      }

      const resolved = await resolveWorkflowDir(taskId);
      if (!resolved) {
        set.status = 404;
        return { error: 'Task not found' };
      }

      const { task, dir, categoryId, themeId } = resolved;

      // 4ファイルの情報を並列取得
      const [research, question, plan, verify] = await Promise.all(
        VALID_FILE_TYPES.map((type) =>
          getFileInfo(join(dir, `${type}.md`), type)
        )
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
      console.error('Error fetching workflow files:', err);
      set.status = 500;
      return { error: 'Failed to fetch workflow files' };
    }
  })

  // ワークフローファイル保存
  .put('/tasks/:taskId/files/:fileType', async ({ params, body, set }) => {
    try {
      const taskId = parseInt(params.taskId);
      if (isNaN(taskId)) {
        set.status = 400;
        return { error: 'Invalid task ID' };
      }

      const fileType = params.fileType as WorkflowFileType;
      if (!VALID_FILE_TYPES.includes(fileType)) {
        set.status = 400;
        return { error: `Invalid file type. Must be one of: ${VALID_FILE_TYPES.join(', ')}` };
      }

      const resolved = await resolveWorkflowDir(taskId);
      if (!resolved) {
        set.status = 404;
        return { error: 'Task not found' };
      }

      const { dir } = resolved;
      const parsedBody = body as { content: string };
      if (!parsedBody?.content && parsedBody?.content !== '') {
        set.status = 400;
        return { error: 'content is required' };
      }

      // ディレクトリ作成（再帰的）
      await mkdir(dir, { recursive: true });

      // ファイル書き込み
      const filePath = join(dir, `${fileType}.md`);
      await writeFile(filePath, parsedBody.content, 'utf-8');

      // workflowStatus の自動更新
      let newStatus: string | undefined;
      const currentStatus = resolved.task.workflowStatus;

      if (fileType === 'research' && (!currentStatus || currentStatus === 'draft')) {
        newStatus = 'research_done';
      } else if (fileType === 'plan' && (!currentStatus || currentStatus === 'research_done')) {
        newStatus = 'plan_created';
      }
      // verify.mdの保存では自動的にcompletedにしない（ユーザーが明示的に完了ボタンを押す必要がある）

      if (newStatus) {
        await prisma.task.update({
          where: { id: taskId },
          data: { workflowStatus: newStatus, updatedAt: new Date() },
        });
      }

      return {
        success: true,
        fileType,
        path: filePath,
        workflowStatus: newStatus || currentStatus,
      };
    } catch (err) {
      console.error('Error saving workflow file:', err);
      set.status = 500;
      return { error: 'Failed to save workflow file' };
    }
  })

  // プラン承認
  .post('/tasks/:taskId/approve-plan', async ({ params, body, set }) => {
    try {
      const taskId = parseInt(params.taskId);
      if (isNaN(taskId)) {
        set.status = 400;
        return { error: 'Invalid task ID' };
      }

      const parsedBody = body as { approved: boolean; reason?: string };
      if (typeof parsedBody?.approved !== 'boolean') {
        set.status = 400;
        return { error: 'approved (boolean) is required' };
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
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
          const { WorkflowOrchestrator } = await import('../services/workflow/workflow-orchestrator');
          const orchestrator = WorkflowOrchestrator.getInstance();
          // 非同期で実装フェーズを開始（レスポンスを待たない）
          orchestrator.advanceWorkflow(taskId).then((result) => {
            console.log(`[Workflow] Auto-advance after approval for task ${taskId}:`, result.success ? 'success' : result.error);
          }).catch((err) => {
            console.error(`[Workflow] Auto-advance after approval failed for task ${taskId}:`, err);
          });
        } catch (err) {
          console.error('[Workflow] Failed to auto-advance after approval:', err);
        }
      }

      return {
        success: true,
        task: updatedTask,
        workflowStatus: newStatus,
        autoAdvance: parsedBody.approved, // フロントエンドにauto-advanceが開始されたことを通知
      };
    } catch (err) {
      console.error('Error approving plan:', err);
      set.status = 500;
      return { error: 'Failed to approve plan' };
    }
  })

  // ワークフローステータス更新
  .put('/tasks/:taskId/status', async ({ params, body, set }) => {
    try {
      const taskId = parseInt(params.taskId);
      if (isNaN(taskId)) {
        set.status = 400;
        return { error: 'Invalid task ID' };
      }

      const parsedBody = body as { status: string };
      if (!parsedBody?.status || !VALID_WORKFLOW_STATUSES.includes(parsedBody.status as any)) {
        set.status = 400;
        return { error: `Invalid status. Must be one of: ${VALID_WORKFLOW_STATUSES.join(', ')}` };
      }

      const task = await prisma.task.findUnique({ where: { id: taskId } });
      if (!task) {
        set.status = 404;
        return { error: 'Task not found' };
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
      console.error('Error updating workflow status:', err);
      set.status = 500;
      return { error: 'Failed to update workflow status' };
    }
  })

  // ワークフローの次のフェーズを実行
  .post('/workflow/tasks/:taskId/advance', async ({ params, set }) => {
    try {
      const taskId = parseInt(params.taskId);
      if (isNaN(taskId)) {
        set.status = 400;
        return { error: 'Invalid task ID' };
      }

      const { WorkflowOrchestrator } = await import('../services/workflow/workflow-orchestrator');
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
      resultPromise.then(async (result) => {
        console.log(`[Workflow] Advance completed for task ${taskId}:`, result.success ? 'success' : result.error);
      }).catch((err) => {
        console.error(`[Workflow] Advance failed for task ${taskId}:`, err);
      });

      return {
        success: true,
        message: 'ワークフローフェーズの実行を開始しました',
        taskId,
        async: true,
      };
    } catch (err) {
      console.error('Error advancing workflow:', err);
      set.status = 500;
      return { error: 'Failed to advance workflow' };
    }
  });
