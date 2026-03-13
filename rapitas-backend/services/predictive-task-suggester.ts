/**
 * 予測型タスク提案サービス
 *
 * ユーザーの行動パターン（時間帯、曜日、完了率）を分析し、
 * 「今やるべきタスク」をランキング形式で提案する
 */
import { prisma } from '../config/database';
import { createLogger } from '../config/logger';

const _log = createLogger('predictive-suggester');

interface TaskSuggestion {
  taskId: number;
  title: string;
  priority: string;
  themeId: number | null;
  themeName: string | null;
  score: number;
  reasons: string[];
  estimatedFocusLevel: 'high' | 'medium' | 'low';
}

interface ProductivityPattern {
  hourOfDay: number;
  dayOfWeek: number;
  completionRate: number;
  avgTasksCompleted: number;
  preferredPriority: string | null;
  preferredThemeId: number | null;
}

/**
 * 現在の時間帯・曜日に最適なタスクをランキングで提案
 */
export async function getSuggestedTasks(limit: number = 5): Promise<{
  suggestions: TaskSuggestion[];
  currentPattern: ProductivityPattern;
  focusLevel: 'high' | 'medium' | 'low';
  message: string;
}> {
  const now = new Date();
  const hourOfDay = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

  // 1. 現在の生産性パターンを取得
  const pattern = await analyzeCurrentPattern(hourOfDay, dayOfWeek);

  // 2. 未完了タスクを取得
  const openTasks = await prisma.task.findMany({
    where: {
      status: { in: ['todo', 'in-progress'] },
      parentId: null,
    },
    include: {
      theme: { select: { id: true, name: true } },
      taskLabels: { include: { label: true } },
      pomodoroSessions: {
        where: { status: 'completed' },
        select: { id: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  if (openTasks.length === 0) {
    return {
      suggestions: [],
      currentPattern: pattern,
      focusLevel:
        pattern.completionRate > 0.7 ? 'high' : pattern.completionRate > 0.4 ? 'medium' : 'low',
      message: '未完了のタスクがありません',
    };
  }

  // 3. 各タスクにスコアを付与
  const scored: TaskSuggestion[] = [];

  for (const task of openTasks) {
    const { score, reasons } = calculateTaskScore(task, pattern, hourOfDay, dayOfWeek);

    scored.push({
      taskId: task.id,
      title: task.title,
      priority: task.priority,
      themeId: task.themeId,
      themeName: task.theme?.name ?? null,
      score: Math.round(score * 100) / 100,
      reasons,
      estimatedFocusLevel: score > 70 ? 'high' : score > 40 ? 'medium' : 'low',
    });
  }

  // 4. スコア順にソートして上位を返す
  scored.sort((a, b) => b.score - a.score);
  const suggestions = scored.slice(0, limit);

  const focusLevel: 'high' | 'medium' | 'low' =
    pattern.completionRate > 0.7 ? 'high' : pattern.completionRate > 0.4 ? 'medium' : 'low';

  const messages: Record<string, string> = {
    high: '集中力が高い時間帯です。重要なタスクに取り組みましょう',
    medium: '標準的な生産性の時間帯です',
    low: '集中力が低下する傾向の時間帯です。軽いタスクがおすすめです',
  };

  return {
    suggestions,
    currentPattern: pattern,
    focusLevel,
    message: messages[focusLevel],
  };
}

/**
 * 時間帯別の生産性ヒートマップを生成
 */
export async function getProductivityHeatmap(days: number = 90): Promise<{
  heatmap: Array<{ hour: number; day: number; completions: number; avgDuration: number }>;
  peakHours: number[];
  lowHours: number[];
}> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const completedBehaviors = await prisma.userBehavior.findMany({
    where: {
      actionType: 'task_completed',
      createdAt: { gte: cutoff },
    },
    select: { createdAt: true },
  });

  // 時間帯×曜日の集計
  const grid: Record<string, { completions: number; count: number }> = {};

  for (const b of completedBehaviors) {
    const hour = b.createdAt.getHours();
    const day = b.createdAt.getDay();
    const key = `${hour}-${day}`;
    if (!grid[key]) grid[key] = { completions: 0, count: 0 };
    grid[key].completions++;
    grid[key].count++;
  }

  const heatmap: Array<{ hour: number; day: number; completions: number; avgDuration: number }> =
    [];
  const hourTotals: Record<number, number> = {};

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const key = `${hour}-${day}`;
      const data = grid[key] || { completions: 0, count: 0 };
      heatmap.push({
        hour,
        day,
        completions: data.completions,
        avgDuration: 0,
      });
      hourTotals[hour] = (hourTotals[hour] || 0) + data.completions;
    }
  }

  // ピーク時間帯と低調時間帯
  const sortedHours = Object.entries(hourTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([h]) => parseInt(h));

  const peakHours = sortedHours.slice(0, 3);
  const lowHours =
    sortedHours.filter((h) => hourTotals[h] === 0).length > 0 ? sortedHours.slice(-3) : [];

  return { heatmap, peakHours, lowHours };
}

export async function getHeatmapCellTasks(
  day: number,
  hour: number,
  days: number = 90,
): Promise<Array<{ taskId: number; title: string; completedAt: string }>> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const behaviors = await prisma.userBehavior.findMany({
    where: {
      actionType: 'task_completed',
      createdAt: { gte: cutoff },
    },
    select: {
      taskId: true,
      createdAt: true,
    },
  });

  const matching = behaviors.filter((b) => {
    return b.createdAt.getDay() === day && b.createdAt.getHours() === hour && b.taskId != null;
  });

  if (matching.length === 0) return [];

  const taskIds = [...new Set(matching.map((b) => b.taskId!))];
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, title: true },
  });

  const taskMap = new Map(tasks.map((t) => [t.id, t.title]));

  return matching
    .filter((b) => taskMap.has(b.taskId!))
    .map((b) => ({
      taskId: b.taskId!,
      title: taskMap.get(b.taskId!) || '',
      completedAt: b.createdAt.toISOString(),
    }))
    .slice(0, 20);
}

// ──── 内部ヘルパー ────

async function analyzeCurrentPattern(
  hourOfDay: number,
  dayOfWeek: number,
): Promise<ProductivityPattern> {
  // 過去60日の同時間帯・同曜日の行動データを取得
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const behaviors = await prisma.userBehavior.findMany({
    where: {
      actionType: { in: ['task_completed', 'task_started'] },
      createdAt: { gte: sixtyDaysAgo },
    },
    select: {
      actionType: true,
      createdAt: true,
      taskId: true,
      metadata: true,
    },
  });

  // 同時間帯（±1時間）・同曜日のデータ
  const sameTimeSlot = behaviors.filter((b) => {
    const h = b.createdAt.getHours();
    const d = b.createdAt.getDay();
    return Math.abs(h - hourOfDay) <= 1 && d === dayOfWeek;
  });

  const completions = sameTimeSlot.filter((b) => b.actionType === 'task_completed');
  const starts = sameTimeSlot.filter((b) => b.actionType === 'task_started');

  // 完了率
  const completionRate = starts.length > 0 ? Math.min(1, completions.length / starts.length) : 0.5;

  // この時間帯で完了したタスクの優先度分布
  let preferredPriority: string | null = null;
  let preferredThemeId: number | null = null;

  if (completions.length > 0) {
    const taskIds = completions.map((c) => c.taskId).filter((id): id is number => id !== null);

    if (taskIds.length > 0) {
      const tasks = await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { priority: true, themeId: true },
      });

      // 最頻出の優先度
      const priorityCount: Record<string, number> = {};
      const themeCount: Record<number, number> = {};

      for (const t of tasks) {
        priorityCount[t.priority] = (priorityCount[t.priority] || 0) + 1;
        if (t.themeId) themeCount[t.themeId] = (themeCount[t.themeId] || 0) + 1;
      }

      preferredPriority = Object.entries(priorityCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      preferredThemeId =
        Object.entries(themeCount).length > 0
          ? parseInt(Object.entries(themeCount).sort((a, b) => b[1] - a[1])[0][0])
          : null;
    }
  }

  // 週の平均完了数
  const weekCount = new Set(
    completions.map((c) => {
      const d = new Date(c.createdAt);
      return `${d.getFullYear()}-W${Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000))}`;
    }),
  ).size;
  const avgTasksCompleted = weekCount > 0 ? completions.length / weekCount : 0;

  return {
    hourOfDay,
    dayOfWeek,
    completionRate: Math.round(completionRate * 100) / 100,
    avgTasksCompleted: Math.round(avgTasksCompleted * 10) / 10,
    preferredPriority,
    preferredThemeId,
  };
}

function calculateTaskScore(
  task: {
    id: number;
    priority: string;
    dueDate: Date | null;
    themeId: number | null;
    estimatedHours: number | null;
    status: string;
    updatedAt: Date;
    pomodoroSessions: Array<{ id: number }>;
  },
  pattern: ProductivityPattern,
  hourOfDay: number,
  _dayOfWeek: number,
): { score: number; reasons: string[] } {
  let score = 50; // ベーススコア
  const reasons: string[] = [];

  // 1. 優先度マッチング（パターンで成功しやすい優先度にボーナス）
  if (pattern.preferredPriority === task.priority) {
    score += 15;
    reasons.push(`この時間帯では${task.priority}優先度の完了率が高い`);
  }

  // 2. 優先度の絶対スコア
  const priorityScores: Record<string, number> = { urgent: 25, high: 15, medium: 5, low: 0 };
  score += priorityScores[task.priority] ?? 0;

  // 3. テーママッチング
  if (pattern.preferredThemeId && task.themeId === pattern.preferredThemeId) {
    score += 10;
    reasons.push('この時間帯でよく取り組むテーマ');
  }

  // 4. 期限の近さ
  if (task.dueDate) {
    const daysUntilDue = (task.dueDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    if (daysUntilDue < 0) {
      score += 30;
      reasons.push('期限超過');
    } else if (daysUntilDue < 1) {
      score += 25;
      reasons.push('本日が期限');
    } else if (daysUntilDue < 3) {
      score += 15;
      reasons.push('期限が近い');
    }
  }

  // 5. 集中力レベルに応じたタスクサイズ推奨
  const isHighFocus = pattern.completionRate > 0.7;
  const isLowFocus = pattern.completionRate < 0.4;

  if (isHighFocus && (task.estimatedHours ?? 0) >= 2) {
    score += 10;
    reasons.push('集中力が高い時間帯 → 大きいタスク推奨');
  } else if (isLowFocus && (task.estimatedHours ?? 0) <= 1) {
    score += 10;
    reasons.push('集中力低下傾向 → 軽いタスク推奨');
  }

  // 6. 進行中タスクにボーナス（コンテキストスイッチ軽減）
  if (task.status === 'in-progress') {
    score += 20;
    reasons.push('進行中のタスク（切替コスト低）');
  }

  // 7. ポモドーロ実績があるタスク（着手済み）
  if (task.pomodoroSessions.length > 0) {
    score += 5;
    reasons.push(`ポモドーロ${task.pomodoroSessions.length}回実績あり`);
  }

  // 8. 朝（集中力高い傾向）は重要タスク、夕方以降は軽いタスク
  if (hourOfDay >= 6 && hourOfDay <= 11) {
    if (task.priority === 'high' || task.priority === 'urgent') {
      score += 5;
      reasons.push('午前中は重要タスクに最適');
    }
  } else if (hourOfDay >= 17) {
    if (task.priority === 'low' || task.priority === 'medium') {
      score += 5;
    }
  }

  return { score, reasons };
}
