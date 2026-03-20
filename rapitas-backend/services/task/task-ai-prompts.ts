/**
 * Task AI Prompts
 *
 * System prompt and prompt builder utilities for AI-generated task suggestions.
 * Does NOT make API calls or interact with the database.
 */

/**
 * System prompt that instructs the AI to produce SMART task suggestions in JSON.
 *
 * NOTE: Format change here requires matching update to parseSuggestionResponse in task-suggestions.ts.
 */
export const AI_SUGGESTION_SYSTEM_PROMPT = `あなたはタスク管理AIアシスタントです。テーマの情報、過去のタスク履歴、そしてユーザーの行動パターンを分析し、パーソナライズされた次のタスクを提案します。

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

/**
 * Formats a list of completed tasks into the numbered summary used in the AI prompt.
 *
 * @param completedTasks - Array of completed task records / 完了タスクレコードの配列
 * @returns Formatted multi-line string / フォーマット済み複数行文字列
 */
export function buildTaskSummary(
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

/**
 * Formats recurring task patterns for the AI prompt.
 *
 * @param taskPatterns - Array of task pattern records / タスクパターンレコードの配列
 * @returns Formatted string or empty string if no patterns / パターンがない場合は空文字列
 */
export function buildPatternSummary(
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

/**
 * Formats user behavior summary for the AI prompt.
 *
 * @param behaviorSummary - Behavior summary record or null / 行動サマリーレコードまたはnull
 * @returns Formatted string or empty string / フォーマット済み文字列
 */
export function buildPreferenceSummary(
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
