/**
 * gantt-utils - Gantt チャートの日付計算とバー配置ユーティリティ
 *
 * 日付とpxの変換、タスクバーの座標計算、矢印パス生成などの純関数群
 */

export interface GanttViewport {
  startDate: Date;
  endDate: Date;
  width: number;
  height: number;
  rowHeight: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

export interface GanttBarData {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  taskId: number;
  title: string;
  status: string;
}

export interface ArrowData {
  fromTaskId: number;
  toTaskId: number;
  path: string;
}

/**
 * 日付をビューポート内のX座標に変換
 */
export function dateToX(date: Date, viewport: GanttViewport): number {
  const { startDate, endDate, width, margin } = viewport;
  const totalDays = Math.ceil(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  const targetDays = Math.ceil(
    (date.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (totalDays <= 0) return margin.left;

  const chartWidth = width - margin.left - margin.right;
  return margin.left + (targetDays / totalDays) * chartWidth;
}

/**
 * X座標からビューポート内の日付に変換
 */
export function xToDate(x: number, viewport: GanttViewport): Date {
  const { startDate, endDate, width, margin } = viewport;
  const chartWidth = width - margin.left - margin.right;
  const normalizedX = (x - margin.left) / chartWidth;

  const totalMs = endDate.getTime() - startDate.getTime();
  const targetMs = startDate.getTime() + normalizedX * totalMs;

  return new Date(targetMs);
}

/**
 * タスクをガントバーに変換
 */
export function taskToBar(
  task: {
    id: number;
    title: string;
    status: string;
    dueDate?: string | null;
    estimatedHours?: number | null;
    theme?: { color?: string } | null;
  },
  index: number,
  viewport: GanttViewport,
): GanttBarData {
  const { rowHeight, margin } = viewport;

  // デフォルトの日付範囲（期限がない場合）
  let startDate: Date;
  let endDate: Date;

  if (task.dueDate) {
    endDate = new Date(task.dueDate);
    // 推定時間がある場合はそれを基に開始日を計算、なければ7日前
    const daysToSubtract = task.estimatedHours
      ? Math.max(1, Math.ceil(task.estimatedHours / 8))
      : 7;
    startDate = new Date(
      endDate.getTime() - daysToSubtract * 24 * 60 * 60 * 1000,
    );
  } else {
    // 期限がない場合は今日から推定時間分またはデフォルト7日間
    startDate = new Date();
    const daysToAdd = task.estimatedHours
      ? Math.max(1, Math.ceil(task.estimatedHours / 8))
      : 7;
    endDate = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  }

  const x = dateToX(startDate, viewport);
  const width = dateToX(endDate, viewport) - x;
  const y = margin.top + index * rowHeight;
  const height = rowHeight - 4; // 4px のマージン

  // ステータスに基づく色
  let color = task.theme?.color || '#6366F1';
  if (task.status === 'completed') {
    color = '#10B981'; // green-500
  } else if (task.status === 'in_progress') {
    color = '#3B82F6'; // blue-500
  } else if (task.status === 'blocked') {
    color = '#F59E0B'; // amber-500
  }

  return {
    x: Math.max(x, margin.left),
    y,
    width: Math.max(width, 20), // 最小幅20px
    height,
    color,
    taskId: task.id,
    title: task.title,
    status: task.status,
  };
}

/**
 * 依存関係の矢印パスを生成
 */
export function arrowPath(fromBar: GanttBarData, toBar: GanttBarData): string {
  const fromX = fromBar.x + fromBar.width;
  const fromY = fromBar.y + fromBar.height / 2;
  const toX = toBar.x;
  const toY = toBar.y + toBar.height / 2;

  // シンプルなL字パス
  const midX = fromX + (toX - fromX) / 2;

  return `M ${fromX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${toX - 8} ${toY}`;
}

/**
 * 矢印の先端パスを生成
 */
export function arrowheadPath(toBar: GanttBarData): string {
  const toX = toBar.x;
  const toY = toBar.y + toBar.height / 2;

  return `M ${toX - 8} ${toY - 4} L ${toX} ${toY} L ${toX - 8} ${toY + 4}`;
}

/**
 * 日付範囲を適切に調整（表示範囲の前後にマージンを追加）
 */
export function adjustDateRange(
  tasks: Array<{ dueDate?: string | null; estimatedHours?: number | null }>,
  margin: { before: number; after: number } = { before: 7, after: 7 },
): { start: Date; end: Date } {
  if (tasks.length === 0) {
    const now = new Date();
    return {
      start: new Date(now.getTime() - margin.before * 24 * 60 * 60 * 1000),
      end: new Date(now.getTime() + margin.after * 24 * 60 * 60 * 1000),
    };
  }

  const dates: Date[] = [];

  tasks.forEach((task) => {
    if (task.dueDate) {
      const dueDate = new Date(task.dueDate);
      dates.push(dueDate);

      // 推定時間がある場合は開始日も推定
      if (task.estimatedHours) {
        const daysToSubtract = Math.max(1, Math.ceil(task.estimatedHours / 8));
        const startDate = new Date(
          dueDate.getTime() - daysToSubtract * 24 * 60 * 60 * 1000,
        );
        dates.push(startDate);
      }
    }
  });

  if (dates.length === 0) {
    // 期限が設定されたタスクがない場合は今日を中心とした期間
    const now = new Date();
    return {
      start: new Date(now.getTime() - margin.before * 24 * 60 * 60 * 1000),
      end: new Date(now.getTime() + margin.after * 24 * 60 * 60 * 1000),
    };
  }

  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

  return {
    start: new Date(minDate.getTime() - margin.before * 24 * 60 * 60 * 1000),
    end: new Date(maxDate.getTime() + margin.after * 24 * 60 * 60 * 1000),
  };
}

/**
 * 週次グリッド線のX座標を計算
 */
export function getWeekGridLines(viewport: GanttViewport): number[] {
  const { startDate, endDate } = viewport;
  const lines: number[] = [];

  const current = new Date(startDate);
  // 次の月曜日に調整
  while (current.getDay() !== 1) {
    current.setDate(current.getDate() + 1);
  }

  while (current <= endDate) {
    lines.push(dateToX(current, viewport));
    current.setDate(current.getDate() + 7);
  }

  return lines;
}

/**
 * 日次グリッド線のX座標を計算（詳細表示用）
 */
export function getDayGridLines(viewport: GanttViewport): number[] {
  const { startDate, endDate } = viewport;
  const lines: number[] = [];

  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  while (current <= endDate) {
    lines.push(dateToX(current, viewport));
    current.setDate(current.getDate() + 1);
  }

  return lines;
}
