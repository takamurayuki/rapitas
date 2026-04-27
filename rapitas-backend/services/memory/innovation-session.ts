/**
 * Innovation Session
 *
 * Periodically generates novel, cross-cutting ideas by analyzing completed
 * tasks, existing features, and global ideas from a "product innovator"
 * perspective. Runs on a configurable schedule (default: twice daily).
 *
 * Unlike the improvement-focused idea extractor, this module specifically
 * targets creative recombination and latent user needs.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { getLocalLLMStatus } from '../local-llm';
import { submitIdea } from './idea-box-service';

const log = createLogger('memory:innovation-session');

/** How often sessions run (ms). Default: every 12 hours. */
const SESSION_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Minimum completed tasks since last session to justify running. */
const MIN_NEW_COMPLETIONS = 2;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let lastRunAt: Date | null = null;

const INNOVATION_PROMPT = `あなたはプロダクトイノベーターです。
以下のプロジェクト情報から、既存機能の「組み合わせ」や「転用」で生まれる
新しい価値を提案してください。改善やバグ修正ではなく、斬新なアイデアを求めています。

## 思考フレームワーク
- 既存機能AをBの文脈で使うとどうなるか？（機能の転用）
- ユーザーがまだ気づいていない潜在ニーズは？
- 競合アプリ（Todoist, Linear, Notion）にない、このアプリだからこそ可能な体験は？
- 「もし〇〇ができたら」という仮説的な提案
- 異分野（ゲーム、SNS、教育、ヘルスケア）のパターンを取り入れられないか？

## 禁止
- 「〇〇を改善する」「〇〇のバグを修正する」系の改善提案
- 既に存在する機能の繰り返し
- 抽象的すぎて実行できない提案（「AIを活用する」等）

## 最近完了したタスク
{recentTasks}

## 現在のアプリの主要機能
{features}

## IdeaBoxの既存アイデア（重複回避）
{existingIdeas}

新しいアイデアを2〜3件、JSON配列で返してください（他のテキスト不要）:
[{"title":"斬新なタイトル","content":"具体的な説明。何が新しく、なぜユーザーに価値があるか"}]

本当に新しいアイデアがなければ空配列 [] を返してください。無理に数を合わせないでください。`;

/** Core feature list — injected into the prompt for cross-pollination. */
const APP_FEATURES = [
  'AIコパイロット（チャット + タスク分析 + エージェント実行）',
  'アイデアボックス（改善・革新アイデアの蓄積）',
  'デイリーブリーフィング（AI朝の計画提案）',
  'ポモドーロ + フォーカスモード',
  '音声入力でタスク登録',
  'ナレッジベース + 知識グラフ',
  'ワークフロー学習（パターン認識 + 工数推定）',
  'ガントチャート + 依存関係グラフ',
  '自動実行モード（IdeaBox連携タスク生成）',
  '学習機能（フラッシュカード + 学習目標 + 試験対策）',
  'GitHub連携（Issue同期 + PR管理）',
  'ダッシュボード（バーンアップ + ヒートマップ + コスト最適化）',
].join('\n- ');

/**
 * Run a single innovation session.
 * Gathers context, calls LLM, and submits novel ideas to the IdeaBox.
 *
 * @returns Number of ideas generated / 生成されたアイデア数
 */
export async function runInnovationSession(): Promise<number> {
  log.info('Starting innovation session');

  const now = new Date();
  const since = lastRunAt ?? new Date(now.getTime() - SESSION_INTERVAL_MS);

  // Check if enough work has been done since last session
  const recentCount = await prisma.task.count({
    where: {
      status: { in: ['done', 'completed'] },
      completedAt: { gte: since },
      parentId: null,
    },
  });

  if (recentCount < MIN_NEW_COMPLETIONS) {
    log.info({ recentCount }, 'Not enough completions since last session, skipping');
    lastRunAt = now;
    return 0;
  }

  // Gather context
  const [recentTasks, existingIdeas] = await Promise.all([
    prisma.task.findMany({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: since },
        parentId: null,
      },
      select: { title: true, description: true, theme: { select: { name: true } } },
      orderBy: { completedAt: 'desc' },
      take: 15,
    }),
    prisma.knowledgeEntry.findMany({
      where: { sourceType: 'idea_box', forgettingStage: 'active' },
      select: { title: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  const recentTasksText =
    recentTasks.map((t) => `- ${t.title}${t.theme?.name ? ` [${t.theme.name}]` : ''}`).join('\n') ||
    '(なし)';

  const existingIdeasText = existingIdeas.map((i) => `- ${i.title}`).join('\n') || '(なし)';

  const prompt = INNOVATION_PROMPT.replace('{recentTasks}', recentTasksText)
    .replace('{features}', APP_FEATURES)
    .replace('{existingIdeas}', existingIdeasText);

  // Use Haiku for innovation — needs stronger reasoning than local LLM
  const localStatus = await getLocalLLMStatus().catch(() => ({ available: false }));
  const useLocal = (localStatus as { available: boolean }).available;

  try {
    const response = await sendAIMessage({
      provider: useLocal ? 'ollama' : 'claude',
      model: useLocal ? 'llama3.2' : 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 800,
    });

    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      log.info('No innovation ideas generated');
      lastRunAt = now;
      return 0;
    }

    const ideas = (JSON.parse(jsonMatch[0]) as Array<{ title: string; content: string }>)
      .filter((i) => i.title && i.content)
      .slice(0, 3);

    let created = 0;
    for (const idea of ideas) {
      await submitIdea({
        title: idea.title,
        content: idea.content,
        source: 'innovation_session',
        scope: 'global',
        confidence: 0.75,
      });
      created++;
    }

    // Enrich + review pipeline runs automatically via submitIdea

    log.info({ created, recentCount }, 'Innovation session complete');
    lastRunAt = now;
    return created;
  } catch (err) {
    log.warn({ err }, 'Innovation session failed (non-critical)');
    lastRunAt = now;
    return 0;
  }
}

/**
 * Start the periodic innovation session scheduler.
 * Safe to call multiple times — only one interval will be active.
 */
export function startInnovationScheduler(): void {
  if (intervalHandle) return;

  log.info({ intervalHours: SESSION_INTERVAL_MS / 3600000 }, 'Innovation scheduler started');

  // Run first session after a short delay (let the server warm up)
  setTimeout(() => {
    runInnovationSession().catch(() => {});
  }, 60_000);

  intervalHandle = setInterval(() => {
    runInnovationSession().catch(() => {});
  }, SESSION_INTERVAL_MS);
}

/**
 * Stop the periodic innovation session scheduler.
 */
export function stopInnovationScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    log.info('Innovation scheduler stopped');
  }
}
