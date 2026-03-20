/**
 * Learning Goal Helpers
 *
 * Shared types and pure utility functions for learning goal plan generation.
 * Does not import Elysia or Prisma; safe to import from any module.
 */

/** Shape of the AI-generated learning plan JSON */
export type GeneratedLearningPlan = {
  themeName?: string;
  themeDescription?: string;
  phases: {
    name: string;
    days: number;
    description?: string;
    tasks: {
      title: string;
      description: string;
      estimatedHours?: number;
      priority?: string;
      subtasks?: {
        title: string;
        description?: string;
        estimatedHours?: number;
      }[];
    }[];
  }[];
  recommendedResources?: {
    title: string;
    type: string;
    description: string;
    url?: string;
  }[];
  tips?: string[];
};

/**
 * Builds a task description that includes the learning goal and phase context.
 *
 * @param phaseName - Name of the learning phase / 学習フェーズ名
 * @param description - Task description text / タスク説明文
 * @param goalTitle - Title of the parent learning goal / 学習目標のタイトル
 * @returns Formatted description string / フォーマット済み説明文字列
 */
export function buildTaskDescription(
  phaseName: string,
  description: string,
  goalTitle: string,
): string {
  return `**学習目標:** ${goalTitle}\n**フェーズ:** ${phaseName}\n\n${description}`;
}

/**
 * Generates a structured fallback learning plan without AI assistance.
 *
 * @param title - Learning goal title / 学習目標タイトル
 * @param currentLevel - Current skill level or null / 現在のスキルレベル
 * @param targetLevel - Target skill level or null / 目標スキルレベル
 * @param totalDays - Total study days available / 学習可能日数
 * @param dailyHours - Hours of study available per day / 1日の学習時間
 * @returns A structured learning plan / 構造化された学習プラン
 */
export function generateFallbackPlan(
  title: string,
  currentLevel: string | null,
  targetLevel: string | null,
  totalDays: number,
  dailyHours: number,
): GeneratedLearningPlan {
  const phaseDays = Math.floor(totalDays / 3);

  return {
    themeName: title,
    themeDescription: `${title}の学習`,
    phases: [
      {
        name: '基礎固め',
        days: phaseDays,
        description: '基本的な知識やスキルを習得するフェーズ',
        tasks: [
          {
            title: `${title}の基本概念を学習`,
            description: `${title}に関する基礎知識を体系的に学習します。入門書やオンラインコースを活用してください。`,
            estimatedHours: dailyHours * 5,
            priority: 'high',
            subtasks: [
              {
                title: '入門教材の選定と学習環境の準備',
                description: '評価の高い入門書やオンラインコースを選び、学習環境を整えます',
                estimatedHours: 2,
              },
              {
                title: '基本概念の理解（第1週）',
                description: '選定した教材の前半部分を学習し、基本用語と概念を理解します',
                estimatedHours: Math.floor((dailyHours * 5 - 2) / 2),
              },
              {
                title: '基本概念の定着（第2週）',
                description: '教材の後半部分を学習し、演習問題やサンプルで理解を深めます',
                estimatedHours: Math.ceil((dailyHours * 5 - 2) / 2),
              },
            ],
          },
          {
            title: '学習ロードマップの作成',
            description: `${currentLevel || '現在のレベル'}から${targetLevel || '目標レベル'}に到達するためのロードマップを整理します。`,
            estimatedHours: 2,
            priority: 'high',
            subtasks: [
              {
                title: '現在のスキルレベルの棚卸し',
                description: '現在できること・できないことを具体的にリストアップします',
                estimatedHours: 0.5,
              },
              {
                title: '目標達成に必要なスキルの洗い出し',
                description: '目標レベルに必要なスキルを調査し、習得すべき項目を特定します',
                estimatedHours: 1,
              },
              {
                title: '学習計画の具体化',
                description: '優先順位をつけて、週単位・月単位の学習計画を立てます',
                estimatedHours: 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '実践・応用',
        days: phaseDays,
        description: '学んだ知識を実践に適用するフェーズ',
        tasks: [
          {
            title: `${title}の応用課題に取り組む`,
            description: '基礎知識を活かした応用的な課題やプロジェクトに取り組みます。',
            estimatedHours: dailyHours * 7,
            priority: 'high',
            subtasks: [
              {
                title: '実践課題の選定',
                description: '現在のレベルに適した実践的な課題やミニプロジェクトを選びます',
                estimatedHours: 1,
              },
              {
                title: '課題への取り組み（前半）',
                description: '選定した課題に着手し、基礎知識を応用しながら進めます',
                estimatedHours: Math.floor((dailyHours * 7 - 1) / 2),
              },
              {
                title: '課題への取り組み（後半）と振り返り',
                description: '課題を完成させ、学んだことを整理・記録します',
                estimatedHours: Math.ceil((dailyHours * 7 - 1) / 2),
              },
            ],
          },
          {
            title: '弱点分野の補強',
            description: '基礎段階で見つかった弱点を重点的に学習します。',
            estimatedHours: dailyHours * 3,
            priority: 'medium',
            subtasks: [
              {
                title: '弱点の特定と優先順位付け',
                description: '実践を通じて明らかになった弱点を整理し、優先順位をつけます',
                estimatedHours: 0.5,
              },
              {
                title: '重点学習の実施',
                description: '優先度の高い弱点から順に、追加教材や演習で補強します',
                estimatedHours: dailyHours * 3 - 0.5,
              },
            ],
          },
        ],
      },
      {
        name: '総仕上げ・実力確認',
        days: totalDays - phaseDays * 2,
        description: '目標達成に向けた最終調整フェーズ',
        tasks: [
          {
            title: '総合的な実力テスト',
            description: `${targetLevel || '目標レベル'}に到達しているかを確認する実力テストを行います。`,
            estimatedHours: dailyHours * 3,
            priority: 'high',
            subtasks: [
              {
                title: '模擬テストや実践課題の準備',
                description: '目標レベルを測定できる適切なテストや課題を選定します',
                estimatedHours: 1,
              },
              {
                title: '実力テストの実施',
                description: '時間を計って本番同様の環境でテストを実施します',
                estimatedHours: dailyHours * 3 - 2,
              },
              {
                title: '結果の分析と改善点の特定',
                description: 'テスト結果を分析し、最終調整が必要な箇所を明確にします',
                estimatedHours: 1,
              },
            ],
          },
          {
            title: '復習と最終調整',
            description: 'これまでの学習内容を振り返り、不足している部分を補強します。',
            estimatedHours: dailyHours * 5,
            priority: 'medium',
            subtasks: [
              {
                title: '重要項目の総復習',
                description: 'これまでに学んだ重要概念やスキルを体系的に復習します',
                estimatedHours: Math.floor((dailyHours * 5) / 2),
              },
              {
                title: '最終調整と仕上げ',
                description: '実力テストで判明した弱点を重点的に補強し、目標達成を確実にします',
                estimatedHours: Math.ceil((dailyHours * 5) / 2),
              },
            ],
          },
        ],
      },
    ],
    tips: [
      '毎日同じ時間に学習する習慣をつけましょう',
      '学んだ内容はアウトプットすることで定着します',
      '進捗を定期的に振り返り、プランを調整しましょう',
    ],
  };
}
