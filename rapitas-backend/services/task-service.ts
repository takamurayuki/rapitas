/**
 * Task Service
 * ルーターから分離されたタスク関連のビジネスロジック
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../config/logger';
import { UserBehaviorService } from '../src/services/userBehaviorService';
import { notifyTaskCompleted } from './notification-service';
import {
  sendAIMessage,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  type AIMessage,
} from '../utils/ai-client';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const logger = createLogger('task-service');

// タスク作成時の共通include
const TASK_FULL_INCLUDE = {
  subtasks: { orderBy: { createdAt: 'asc' as const } },
  theme: true,
  project: true,
  milestone: true,
  examGoal: true,
  taskLabels: { include: { label: true } },
} as const;

// ============ タスク作成 ============

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  labels?: string;
  labelIds?: number[];
  estimatedHours?: number;
  dueDate?: string;
  subject?: string;
  parentId?: number;
  projectId?: number;
  milestoneId?: number;
  themeId?: number;
  examGoalId?: number;
  isDeveloperMode?: boolean;
  isAiTaskAnalysis?: boolean;
}

export async function createTask(prisma: PrismaInstance, input: CreateTaskInput) {
  const { parentId, title, labelIds, ...rest } = input;

  if (parentId) {
    return createSubtask(prisma, parentId, title, labelIds, rest);
  }

  return createParentTask(prisma, title, labelIds, rest);
}

async function createSubtask(
  prisma: PrismaInstance,
  parentId: number,
  title: string,
  labelIds: number[] | undefined,
  data: Omit<CreateTaskInput, 'title' | 'parentId' | 'labelIds'>,
) {
  const parentTask = await prisma.task.findUnique({
    where: { id: parentId },
    select: { id: true },
  });

  if (!parentTask) {
    throw new Error(`親タスク(ID: ${parentId})が見つかりません`);
  }

  return prisma.$transaction(
    async (tx) => {
      const existingSubtask = await tx.task.findFirst({
        where: { parentId, title: { equals: title, mode: 'insensitive' } },
      });

      if (existingSubtask) {
        logger.info(
          `[task-service] Duplicate subtask prevented: "${title}" for parent ${parentId}`,
        );
        return tx.task.findUnique({
          where: { id: existingSubtask.id },
          include: TASK_FULL_INCLUDE,
        });
      }

      const task = await tx.task.create({
        data: {
          title,
          ...(data.description && { description: data.description }),
          status: data.status ?? 'todo',
          priority: data.priority ?? 'medium',
          ...(data.labels && { labels: data.labels }),
          ...(data.estimatedHours && { estimatedHours: data.estimatedHours }),
          ...(data.dueDate && { dueDate: new Date(data.dueDate) }),
          ...(data.subject && { subject: data.subject }),
          parentId,
          ...(data.projectId && { projectId: data.projectId }),
          ...(data.milestoneId && { milestoneId: data.milestoneId }),
          ...(data.themeId !== undefined && { themeId: data.themeId }),
          ...(data.examGoalId !== undefined && { examGoalId: data.examGoalId }),
          ...(data.isDeveloperMode !== undefined && { isDeveloperMode: data.isDeveloperMode }),
          ...(data.isAiTaskAnalysis !== undefined && { isAiTaskAnalysis: data.isAiTaskAnalysis }),
        },
      });

      if (labelIds && labelIds.length > 0) {
        await tx.taskLabel.createMany({
          data: labelIds.map((labelId: number) => ({ taskId: task.id, labelId })),
        });
      }

      return tx.task.findUnique({
        where: { id: task.id },
        include: TASK_FULL_INCLUDE,
      });
    },
    { isolationLevel: 'Serializable' },
  );
}

async function createParentTask(
  prisma: PrismaInstance,
  title: string,
  labelIds: number[] | undefined,
  data: Omit<CreateTaskInput, 'title' | 'parentId' | 'labelIds'>,
) {
  const task = await prisma.task.create({
    data: {
      title,
      ...(data.description && { description: data.description }),
      status: data.status ?? 'todo',
      priority: data.priority ?? 'medium',
      ...(data.labels && { labels: data.labels }),
      ...(data.estimatedHours && { estimatedHours: data.estimatedHours }),
      ...(data.dueDate && { dueDate: new Date(data.dueDate) }),
      ...(data.subject && { subject: data.subject }),
      ...(data.projectId && { projectId: data.projectId }),
      ...(data.milestoneId && { milestoneId: data.milestoneId }),
      ...(data.themeId !== undefined && { themeId: data.themeId }),
      ...(data.examGoalId !== undefined && { examGoalId: data.examGoalId }),
      ...(data.isDeveloperMode !== undefined && { isDeveloperMode: data.isDeveloperMode }),
      ...(data.isAiTaskAnalysis !== undefined && { isAiTaskAnalysis: data.isAiTaskAnalysis }),
    },
  });

  if (labelIds && labelIds.length > 0) {
    await prisma.taskLabel.createMany({
      data: labelIds.map((labelId: number) => ({ taskId: task.id, labelId })),
    });
  }

  const createdTask = await prisma.task.findUnique({
    where: { id: task.id },
    include: TASK_FULL_INCLUDE,
  });

  if (createdTask) {
    await UserBehaviorService.recordTaskCreated(createdTask.id, createdTask);
  }

  return createdTask;
}

// ============ タスク更新 ============

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  themeId?: number;
  status?: string;
  priority?: string;
  labels?: string;
  labelIds?: number[];
  estimatedHours?: number;
  dueDate?: string;
  subject?: string;
  projectId?: number;
  milestoneId?: number;
  examGoalId?: number;
  autoApprovePlan?: boolean;
}

export async function updateTask(prisma: PrismaInstance, taskId: number, input: UpdateTaskInput) {
  const { labelIds, ...fields } = input;

  const currentTask = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, parentId: true },
  });

  if (!currentTask) {
    throw new Error(`タスク(ID: ${taskId})が見つかりません`);
  }

  // ストリーク記録
  if (fields.status === 'done') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await prisma.studyStreak.upsert({
      where: { date: today },
      update: { tasksCompleted: { increment: 1 } },
      create: { date: today, studyMinutes: 0, tasksCompleted: 1 },
    });
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(fields.title && { title: fields.title }),
      ...(fields.description !== undefined && { description: fields.description }),
      ...(fields.themeId !== undefined && { themeId: fields.themeId }),
      ...(fields.status && { status: fields.status }),
      ...(fields.status === 'done' && { completedAt: new Date() }),
      ...(fields.status === 'in-progress' &&
        currentTask?.status !== 'in-progress' && { startedAt: new Date() }),
      ...(fields.priority && { priority: fields.priority }),
      ...(fields.labels && { labels: fields.labels }),
      ...(fields.estimatedHours !== undefined && { estimatedHours: fields.estimatedHours }),
      ...(fields.dueDate !== undefined && {
        dueDate: fields.dueDate ? new Date(fields.dueDate) : null,
      }),
      ...(fields.subject !== undefined && { subject: fields.subject }),
      ...(fields.projectId !== undefined && { projectId: fields.projectId }),
      ...(fields.milestoneId !== undefined && { milestoneId: fields.milestoneId }),
      ...(fields.examGoalId !== undefined && { examGoalId: fields.examGoalId }),
      ...(fields.autoApprovePlan !== undefined && { autoApprovePlan: fields.autoApprovePlan }),
    },
  });

  // ラベル更新
  if (labelIds !== undefined) {
    await prisma.taskLabel.deleteMany({ where: { taskId } });
    if (labelIds.length > 0) {
      await prisma.taskLabel.createMany({
        data: labelIds.map((labelId) => ({ taskId, labelId })),
      });
    }
  }

  const updatedTask = await prisma.task.findUnique({
    where: { id: taskId },
    include: TASK_FULL_INCLUDE,
  });

  // ユーザー行動記録（親タスクのみ）
  if (!currentTask?.parentId && updatedTask) {
    if (fields.status && currentTask?.status !== fields.status) {
      if (fields.status === 'in-progress' && currentTask?.status !== 'in-progress') {
        await UserBehaviorService.recordTaskStarted(taskId, updatedTask);
      } else if (fields.status === 'done' && currentTask?.status !== 'done') {
        await UserBehaviorService.recordTaskCompleted(taskId, updatedTask);
        notifyTaskCompleted(taskId, updatedTask.title).catch((err) => {
          logger.warn({ err, taskId }, 'Failed to send task completion notification');
        });
      }
    }

    if (
      fields.title ||
      fields.description !== undefined ||
      fields.priority ||
      fields.themeId !== undefined
    ) {
      await UserBehaviorService.recordBehavior('task_updated', {
        taskId,
        themeId: updatedTask.themeId ?? undefined,
        metadata: {
          changes: {
            title: fields.title !== undefined,
            description: fields.description !== undefined,
            priority: fields.priority !== undefined,
            themeId: fields.themeId !== undefined,
          },
        },
      });
    }
  }

  return updatedTask;
}

// ============ 頻度ベースタスク提案 ============

export async function getFrequencyBasedSuggestions(
  prisma: PrismaInstance,
  themeId: number,
  limit: number,
) {
  const completedTasks = await prisma.task.findMany({
    where: { themeId, parentId: null, status: 'done' },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      estimatedHours: true,
      completedAt: true,
      taskLabels: { include: { label: true } },
    },
    orderBy: { completedAt: 'desc' },
    take: 50,
  });

  const existingTasks = await prisma.task.findMany({
    where: { themeId, parentId: null, status: { in: ['todo', 'in-progress'] } },
    select: { title: true },
  });

  const existingTitles = new Set(
    existingTasks.map((t: { title: string }) => t.title.toLowerCase().trim()),
  );

  const titleFrequency = new Map<
    string,
    {
      title: string;
      count: number;
      lastPriority: string;
      lastEstimatedHours: number | null;
      lastDescription: string | null;
      lastCompletedAt: Date | null;
      labelIds: number[];
    }
  >();

  for (const task of completedTasks) {
    const normalized = task.title.toLowerCase().trim();
    if (existingTitles.has(normalized)) continue;

    const existing = titleFrequency.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      titleFrequency.set(normalized, {
        title: task.title,
        count: 1,
        lastPriority: task.priority,
        lastEstimatedHours: task.estimatedHours,
        lastDescription: task.description,
        lastCompletedAt: task.completedAt,
        labelIds: task.taskLabels?.map((tl: { labelId: number }) => tl.labelId) ?? [],
      });
    }
  }

  return Array.from(titleFrequency.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const aTime = a.lastCompletedAt?.getTime() ?? 0;
      const bTime = b.lastCompletedAt?.getTime() ?? 0;
      return bTime - aTime;
    })
    .slice(0, limit)
    .map((item) => ({
      title: item.title,
      frequency: item.count,
      priority: item.lastPriority,
      estimatedHours: item.lastEstimatedHours,
      description: item.lastDescription,
      labelIds: item.labelIds,
    }));
}

// ============ 重複サブタスク削除 ============

export async function cleanupDuplicateSubtasks(prisma: PrismaInstance, parentId: number) {
  const subtasks = await prisma.task.findMany({
    where: { parentId },
    orderBy: { createdAt: 'asc' },
  });

  const titleMap = new Map<string, typeof subtasks>();
  for (const subtask of subtasks) {
    const normalized = subtask.title.toLowerCase().trim();
    if (!titleMap.has(normalized)) {
      titleMap.set(normalized, []);
    }
    titleMap.get(normalized)!.push(subtask);
  }

  const deletedIds: number[] = [];
  for (const [, duplicates] of titleMap) {
    if (duplicates.length > 1) {
      const toDelete = duplicates.slice(1);
      for (const subtask of toDelete) {
        await prisma.task.delete({ where: { id: subtask.id } });
        deletedIds.push(subtask.id);
        logger.info(
          `[task-service] Deleted duplicate subtask: "${subtask.title}" (id: ${subtask.id})`,
        );
      }
    }
  }

  return deletedIds;
}

export async function cleanupAllDuplicateSubtasks(prisma: PrismaInstance) {
  const allSubtasks = await prisma.task.findMany({
    where: { parentId: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  const parentMap = new Map<number, typeof allSubtasks>();
  for (const subtask of allSubtasks) {
    const parentId = subtask.parentId!;
    if (!parentMap.has(parentId)) {
      parentMap.set(parentId, []);
    }
    parentMap.get(parentId)!.push(subtask);
  }

  const deletedIds: number[] = [];
  const affectedParents: number[] = [];

  for (const [parentId, subtasks] of parentMap) {
    const titleMap = new Map<string, typeof subtasks>();
    for (const subtask of subtasks) {
      const normalized = subtask.title.toLowerCase().trim();
      if (!titleMap.has(normalized)) {
        titleMap.set(normalized, []);
      }
      titleMap.get(normalized)!.push(subtask);
    }

    let parentHadDuplicates = false;
    for (const [, duplicates] of titleMap) {
      if (duplicates.length > 1) {
        parentHadDuplicates = true;
        const toDelete = duplicates.slice(1);
        for (const subtask of toDelete) {
          await prisma.task.delete({ where: { id: subtask.id } });
          deletedIds.push(subtask.id);
          logger.info(
            `[task-service] Deleted duplicate subtask: "${subtask.title}" (id: ${subtask.id}, parent: ${parentId})`,
          );
        }
      }
    }

    if (parentHadDuplicates) {
      affectedParents.push(parentId);
    }
  }

  return { deletedIds, affectedParents };
}

// ============ AI タスク提案 ============

const AI_SUGGESTION_SYSTEM_PROMPT = `あなたはタスク管理AIアシスタントです。テーマの情報、過去のタスク履歴、そしてユーザーの行動パターンを分析し、パーソナライズされた次のタスクを提案します。

**重要**: 提案するタスクは必ずSMART目標の原則に従ってください:
- **Specific（具体的）**: 何を、どこで、どのように行うか明確にする
- **Measurable（測定可能）**: 完了基準を数値や具体的な成果物で定義
- **Achievable（達成可能）**: 実現可能な範囲で設定（ユーザーの実績精度を考慮）
- **Relevant（関連性）**: テーマとの関連性が明確
- **Time-bound（期限）**: ユーザーの過去の実績に基づいた現実的な推定時間

ユーザーの行動パターンを考慮してください:
- 頻繁に実行されるタスクパターンを優先
- ユーザーの好みの作業時間帯に合わせた難易度
- よく使うラベルや優先度の傾向を反映
- 過去の見積精度を考慮した現実的な時間見積もり

過去のタスクがある場合は以下の観点で分析してください:
1. **繰り返しパターン**: 頻度の高いタスクの具体的な次回実行内容
2. **関連タスク**: 完了済みタスクの発展版
3. **未着手作業**: 過去のパターンから推測される具体的作業
4. **改善・最適化**: 測定可能な改善目標

過去のタスクがない場合は、テーマから具体的なタスクを推測:
1. **初期セットアップ**: 具体的な環境構築手順
2. **基本的な実装**: 明確な成果物
3. **ドキュメント化**: 具体的な文書作成
4. **テスト・検証**: 定量的なテスト

回答は必ず以下のJSON形式で返してください:
{
  "analysis": "テーマの特徴や過去のタスク傾向の簡潔な分析（2-3文）",
  "suggestions": [
    {
      "title": "提案タスクのタイトル（動詞＋具体的な対象＋数量/範囲）",
      "description": "タスクの詳細説明（何を・どのように・どこまで）",
      "priority": "low" | "medium" | "high" | "urgent",
      "estimatedHours": 数値（必須、0.5刻み）,
      "reason": "この提案の根拠",
      "category": "recurring" | "extension" | "improvement" | "new",
      "completionCriteria": "完了条件",
      "measurableOutcome": "測定可能な成果",
      "dependencies": "前提条件",
      "suggestedApproach": "推奨される実施方法"
    }
  ]
}`;

interface AISuggestionItem {
  title: string;
  description: string | null;
  priority: string;
  estimatedHours: number | null;
  reason: string | null;
  category: string;
  completionCriteria: string | null;
  measurableOutcome: string | null;
  dependencies: string | null;
  suggestedApproach: string | null;
  labelIds: number[];
  frequency: number;
}

function buildTaskSummary(
  completedTasks: Array<{
    title: string;
    description: string | null;
    priority: string;
    estimatedHours: number | null;
    actualHours: number | null;
    taskLabels?: Array<{ label: { name: string } }>;
  }>,
): string {
  if (completedTasks.length === 0) return '（まだ完了タスクがありません）';

  return completedTasks
    .map((t, i) => {
      const labels = t.taskLabels?.map((tl) => tl.label.name).join(', ') || 'なし';
      const accuracy =
        t.estimatedHours && t.actualHours
          ? `見積精度: ${Math.round((t.actualHours / t.estimatedHours) * 100)}%`
          : '';
      return `${i + 1}. "${t.title}" (優先度: ${t.priority}, 見積: ${t.estimatedHours ?? '未設定'}h, 実績: ${t.actualHours ?? '未記録'}h ${accuracy}, ラベル: ${labels})${t.description ? ` - ${t.description.slice(0, 80)}` : ''}`;
    })
    .join('\n');
}

function buildPatternSummary(
  taskPatterns: Array<{
    taskTitle: string;
    frequency: number;
    priority: string;
    averageTimeToStart: number | null;
    averageTimeToComplete: number | null;
    labelIds: string | null;
  }>,
): string {
  if (taskPatterns.length === 0) return '';

  return (
    '\n\n【頻繁に実行されるタスクパターン】\n' +
    taskPatterns
      .map((p, i) => {
        const avgStart = p.averageTimeToStart
          ? `平均開始時間: ${Math.round(p.averageTimeToStart)}時間後`
          : '';
        const avgComplete = p.averageTimeToComplete
          ? `平均完了時間: ${Math.round(p.averageTimeToComplete)}時間`
          : '';
        return `${i + 1}. "${p.taskTitle}" (頻度: ${p.frequency}回, 優先度: ${p.priority}, ${avgStart}, ${avgComplete})`;
      })
      .join('\n')
  );
}

function buildPreferenceSummary(
  behaviorSummary: {
    preferredTimeOfDay: string | null;
    mostUsedLabels: string | null;
    taskPriorities: string | null;
    averageCompletionTime: number | null;
  } | null,
): string {
  if (!behaviorSummary) return '';

  const prefs = {
    preferredTimeOfDay: behaviorSummary.preferredTimeOfDay,
    mostUsedLabels: behaviorSummary.mostUsedLabels
      ? JSON.parse(behaviorSummary.mostUsedLabels)
      : [],
    taskPriorities: behaviorSummary.taskPriorities
      ? JSON.parse(behaviorSummary.taskPriorities)
      : {},
    averageCompletionTime: behaviorSummary.averageCompletionTime,
  };

  return `\n\n【ユーザーの作業傾向】
- 好みの作業時間帯: ${prefs.preferredTimeOfDay || '不明'}
- 平均完了時間: ${prefs.averageCompletionTime ? `${Math.round(prefs.averageCompletionTime)}時間` : '不明'}
- よく使うラベル: ${
    prefs.mostUsedLabels
      .slice(0, 3)
      .map((l: { labelId: string }) => `${l.labelId}`)
      .join(', ') || 'なし'
  }
- 優先度の傾向: ${
    Object.entries(prefs.taskPriorities)
      .map(([p, c]) => `${p}: ${c}`)
      .join(', ') || '不明'
  }`;
}

function parseSuggestionResponse(
  content: string,
  limit: number,
): {
  suggestions: AISuggestionItem[];
  analysis: string | null;
} {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { suggestions: [], analysis: null };
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const suggestions: AISuggestionItem[] = (parsed.suggestions || [])
    .slice(0, limit)
    .map((s: Record<string, unknown>) => ({
      title: s.title as string,
      description: (s.description as string) || null,
      priority: (s.priority as string) || 'medium',
      estimatedHours: (s.estimatedHours as number) || null,
      reason: (s.reason as string) || null,
      category: (s.category as string) || 'new',
      completionCriteria: (s.completionCriteria as string) || null,
      measurableOutcome: (s.measurableOutcome as string) || null,
      dependencies: (s.dependencies as string) || null,
      suggestedApproach: (s.suggestedApproach as string) || null,
      labelIds: [],
      frequency: 0,
    }));

  return { suggestions, analysis: parsed.analysis || null };
}

export async function generateAISuggestions(
  prisma: PrismaInstance,
  themeId: number,
  limit: number,
): Promise<{
  suggestions: AISuggestionItem[];
  analysis?: string | null;
  source: string;
  tokensUsed?: number;
}> {
  const aiAvailable = await isAnyApiKeyConfigured();
  if (!aiAvailable) {
    return { suggestions: [], source: 'insufficient_data' };
  }

  const theme = await prisma.theme.findUnique({
    where: { id: themeId },
    select: { id: true, name: true, description: true },
  });

  if (!theme) {
    return { suggestions: [], source: 'none' };
  }

  // データ収集を並列実行
  const [completedTasks, taskPatterns, behaviorSummary, existingTasks] = await Promise.all([
    prisma.task.findMany({
      where: { themeId, parentId: null, status: 'done' },
      select: {
        title: true,
        description: true,
        priority: true,
        estimatedHours: true,
        actualHours: true,
        completedAt: true,
        taskLabels: { include: { label: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 30,
    }),
    prisma.taskPattern.findMany({
      where: { themeId, frequency: { gte: 2 } },
      orderBy: [{ frequency: 'desc' }, { lastOccurrence: 'desc' }],
      take: 10,
    }),
    prisma.userBehaviorSummary.findFirst({
      where: { themeId, periodType: { in: ['weekly', 'monthly'] } },
      orderBy: { periodEnd: 'desc' },
    }),
    prisma.task.findMany({
      where: { themeId, parentId: null, status: { in: ['todo', 'in-progress'] } },
      select: { title: true },
    }),
  ]);

  const existingTitles = existingTasks.map((t: { title: string }) => t.title);
  const existingTaskList =
    existingTitles.length > 0
      ? `\n\n## 現在進行中・未着手のタスク（これらと重複しないこと）\n${existingTitles.map((t: string) => `- ${t}`).join('\n')}`
      : '';

  const taskSummary = buildTaskSummary(completedTasks);
  const patternSummaryText = buildPatternSummary(taskPatterns);
  const preferenceSummaryText = buildPreferenceSummary(behaviorSummary);

  const userPrompt =
    completedTasks.length > 0
      ? `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ''}\n\n## 過去の完了タスク（新しい順）\n${taskSummary}${patternSummaryText}${preferenceSummaryText}${existingTaskList}\n\n上記の過去タスクとユーザーの行動パターンを分析し、パーソナライズされた次に取り組むべきタスクを${limit}件提案してください。\n既存の進行中・未着手タスクと重複しない提案をお願いします。`
      : `## テーマ: ${theme.name}${theme.description ? ` (${theme.description})` : ''}\n\nこのテーマに関するタスクはまだありません。${existingTaskList}\n\nテーマの内容から推測して、最初に取り組むべきタスクを${limit}件提案してください。\n既存の進行中・未着手タスクと重複しない提案をお願いします。`;

  try {
    const provider = await getDefaultProvider();
    const messages: AIMessage[] = [{ role: 'user', content: userPrompt }];

    const response = await sendAIMessage({
      provider,
      messages,
      systemPrompt: AI_SUGGESTION_SYSTEM_PROMPT,
      maxTokens: 2048,
    });

    const { suggestions, analysis } = parseSuggestionResponse(response.content, limit);

    if (suggestions.length === 0) {
      logger.error('[task-service] Failed to parse AI response');
      return { suggestions: [], source: 'ai_error' };
    }

    // キャッシュ保存
    await cacheSuggestions(prisma, themeId, suggestions, analysis);

    return { suggestions, analysis, source: 'ai', tokensUsed: response.tokensUsed };
  } catch (error) {
    logger.error({ err: error }, '[task-service] AI suggestion failed');
    return { suggestions: [], source: 'ai_error' };
  }
}

async function cacheSuggestions(
  prisma: PrismaInstance,
  themeId: number,
  suggestions: AISuggestionItem[],
  analysis: string | null,
): Promise<void> {
  try {
    if (!prisma.taskSuggestionCache) return;

    await prisma.taskSuggestionCache.deleteMany({ where: { themeId } });

    if (suggestions.length > 0) {
      await prisma.taskSuggestionCache.createMany({
        data: suggestions.map((s, idx) => ({
          themeId,
          title: s.title,
          description: s.description,
          priority: s.priority,
          estimatedHours: s.estimatedHours,
          reason: s.reason,
          category: s.category,
          labelIds: JSON.stringify(s.labelIds),
          analysis: idx === 0 ? analysis : null,
          completionCriteria: s.completionCriteria,
          measurableOutcome: s.measurableOutcome,
          dependencies: s.dependencies,
          suggestedApproach: s.suggestedApproach,
        })),
      });
    }
  } catch (cacheError) {
    logger.error({ err: cacheError }, '[task-service] Failed to cache suggestions');
  }
}
