/**
 * Critic System - 独立した評価エージェント
 *
 * 仮説の妥当性、計画の不足、実装の品質をチェックする。
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { CriticReviewInput, CriticReviewResult, CriticScore, CriticPhase } from './types';

const log = createLogger('self-learning:critic');

/**
 * レビューを実行
 */
export async function performReview(input: CriticReviewInput): Promise<CriticReviewResult> {
  const score = evaluateContent(input.phase, input.targetContent, input.context);
  const overallScore = score.accuracy * 0.4 + score.logic * 0.35 + score.coverage * 0.25;

  const feedback = generateFeedback(input.phase, score, input.targetContent);
  const suggestions = generateSuggestions(input.phase, score);
  const issues = detectIssues(input.phase, input.targetContent);

  // DBに保存
  await prisma.criticReview.create({
    data: {
      experimentId: input.experimentId,
      phase: input.phase,
      accuracy: score.accuracy,
      logic: score.logic,
      coverage: score.coverage,
      overallScore,
      feedback,
      suggestions: JSON.stringify(suggestions),
      issues: JSON.stringify(issues),
    },
  });

  const result: CriticReviewResult = {
    score,
    overallScore,
    feedback,
    suggestions,
    issues,
  };

  log.info(
    {
      experimentId: input.experimentId,
      phase: input.phase,
      overallScore,
    },
    'Critic review completed',
  );

  return result;
}

/**
 * コンテンツを評価してスコアを算出
 */
function evaluateContent(phase: CriticPhase, content: string, context?: string): CriticScore {
  const contentLength = content.length;
  const hasStructure = content.includes('\n') || content.includes('{');

  // 基本スコアをコンテンツの充実度から算出
  let accuracy = Math.min(1.0, contentLength / 500);
  let logic = hasStructure ? 0.7 : 0.4;
  let coverage = 0.5;

  switch (phase) {
    case 'hypothesis':
      // 仮説には根拠と具体性が必要
      if (content.includes('because') || content.includes('理由')) accuracy += 0.2;
      if (content.includes('if') || content.includes('もし')) logic += 0.15;
      coverage = content.split(',').length > 2 ? 0.8 : 0.5;
      break;

    case 'plan':
      // 計画にはステップと順序が必要
      const stepCount = (content.match(/\d+\./g) || []).length;
      accuracy = Math.min(1.0, stepCount / 5);
      logic = stepCount > 1 ? 0.7 : 0.3;
      if (content.includes('test') || content.includes('テスト')) coverage += 0.2;
      if (content.includes('rollback') || content.includes('リスク')) coverage += 0.1;
      break;

    case 'execution':
      // 実行結果には成果物とステータスが必要
      if (content.includes('success') || content.includes('成功')) accuracy = 0.9;
      if (content.includes('error') || content.includes('エラー')) accuracy = 0.4;
      logic = context ? 0.7 : 0.5;
      coverage = contentLength > 200 ? 0.8 : 0.5;
      break;
  }

  return {
    accuracy: Math.min(1.0, Math.max(0, accuracy)),
    logic: Math.min(1.0, Math.max(0, logic)),
    coverage: Math.min(1.0, Math.max(0, coverage)),
  };
}

/**
 * スコアに基づくフィードバック生成
 */
function generateFeedback(phase: CriticPhase, score: CriticScore, content: string): string {
  const parts: string[] = [];

  if (score.accuracy >= 0.8) {
    parts.push('Content accuracy is strong.');
  } else if (score.accuracy >= 0.5) {
    parts.push('Content accuracy is adequate but could be more specific.');
  } else {
    parts.push('Content accuracy needs significant improvement.');
  }

  if (score.logic >= 0.7) {
    parts.push('Logical structure is well-organized.');
  } else {
    parts.push('Logical flow could be improved with better structure.');
  }

  if (score.coverage >= 0.7) {
    parts.push('Good coverage of relevant aspects.');
  } else {
    parts.push('Coverage is incomplete - consider additional aspects.');
  }

  return parts.join(' ');
}

/**
 * 改善提案の生成
 */
function generateSuggestions(phase: CriticPhase, score: CriticScore): string[] {
  const suggestions: string[] = [];

  if (score.accuracy < 0.7) {
    suggestions.push(
      phase === 'hypothesis'
        ? 'Add specific evidence or data to support the hypothesis.'
        : phase === 'plan'
          ? 'Include more detailed steps with expected outcomes.'
          : 'Document the exact changes made and their effects.',
    );
  }

  if (score.logic < 0.6) {
    suggestions.push('Improve the logical structure with clear cause-effect relationships.');
  }

  if (score.coverage < 0.6) {
    suggestions.push(
      phase === 'plan'
        ? 'Add error handling, rollback strategy, and testing steps.'
        : 'Consider edge cases and alternative scenarios.',
    );
  }

  return suggestions;
}

/**
 * 問題点の検出
 */
function detectIssues(phase: CriticPhase, content: string): string[] {
  const issues: string[] = [];

  if (content.length < 50) {
    issues.push('Content is too brief for thorough analysis.');
  }

  if (phase === 'plan' && !content.toLowerCase().includes('test')) {
    issues.push('No testing strategy mentioned in the plan.');
  }

  if (phase === 'hypothesis' && content.split('.').length < 2) {
    issues.push('Hypothesis lacks supporting reasoning.');
  }

  return issues;
}

/**
 * 実験のレビュー一覧を取得
 */
export async function getReviews(experimentId: number) {
  return prisma.criticReview.findMany({
    where: { experimentId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * フェーズ別の平均スコアを取得
 */
export async function getAverageScores(phase?: CriticPhase) {
  const where: Record<string, unknown> = {};
  if (phase) where.phase = phase;

  const result = await prisma.criticReview.aggregate({
    where,
    _avg: {
      accuracy: true,
      logic: true,
      coverage: true,
      overallScore: true,
    },
    _count: { id: true },
  });

  return {
    count: result._count.id,
    averageAccuracy: result._avg.accuracy ?? 0,
    averageLogic: result._avg.logic ?? 0,
    averageCoverage: result._avg.coverage ?? 0,
    averageOverall: result._avg.overallScore ?? 0,
  };
}
