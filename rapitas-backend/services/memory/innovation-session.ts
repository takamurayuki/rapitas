/**
 * Innovation Session
 *
 * Periodically generates novel, cross-cutting ideas by analyzing each project's
 * recently completed tasks from a "product innovator" perspective. Runs once
 * per theme so every generated idea is tied to a specific project (scope
 * 'project' + themeId) rather than a vague global bucket. Only themes with a
 * working directory are processed (periodic jobs target configured projects).
 *
 * Unlike the improvement-focused idea extractor, this module specifically
 * targets creative recombination and latent user needs.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { sendAIMessage } from '../../utils/ai-client';
import { getLocalLLMStatus } from '../local-llm';
import { getBestLocalModel } from '../local-llm/local-model-selector';
import { submitIdea } from './idea-box-service';
import { getDisabledThemeIds } from '../scheduling/theme-backlog-override-service';

const log = createLogger('memory:innovation-session');

/**
 * Look-back window (ms) for the "recent completions" query on the first run
 * after boot. Timing of WHEN sessions run is owned by the backlog-scheduler.
 */
const SESSION_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Min recently-completed tasks a theme needs before we generate ideas for it. */
const MIN_COMPLETIONS_PER_THEME = 1;
/** Max projects processed per run — bounds LLM cost. */
const MAX_THEMES = 5;
/** Max ideas kept per project per run. */
const IDEAS_PER_THEME = 2;

let lastRunAt: Date | null = null;

const INNOVATION_PROMPT = `あなたはプロダクトイノベーターです。
対象プロジェクトの情報から、既存機能の「組み合わせ」や「転用」で生まれる
新しい価値を提案してください。改善やバグ修正ではなく、斬新なアイデアを求めています。

## 思考フレームワーク
- 既存機能AをBの文脈で使うとどうなるか？（機能の転用）
- ユーザーがまだ気づいていない潜在ニーズは？
- 競合にない、このプロジェクトだからこそ可能な体験は？
- 「もし〇〇ができたら」という仮説的な提案
- 異分野（ゲーム、SNS、教育、ヘルスケア）のパターンを取り入れられないか？

## 禁止
- 「〇〇を改善する」「〇〇のバグを修正する」系の改善提案
- 既に存在する機能の繰り返し
- 抽象的すぎて実行できない提案（「AIを活用する」等）

## 対象プロジェクト
{project}

## このプロジェクトで最近完了したタスク
{recentTasks}

## このプロジェクトの既存アイデア（重複回避）
{existingIdeas}

新しいアイデアを1〜2件、JSON配列で返してください（他のテキスト不要）:
[{"title":"斬新なタイトル","content":"具体的な説明。何が新しく、なぜユーザーに価値があるか"}]

本当に新しいアイデアがなければ空配列 [] を返してください。無理に数を合わせないでください。`;

interface LocalModel {
  provider: 'ollama' | 'claude';
  name: string;
}

/** Generates and files project-scoped ideas for one theme. Returns the count. */
async function generateForTheme(
  theme: { id: number; name: string },
  recentTasks: Array<{ title: string; description: string | null }>,
  existingIdeas: Array<{ title: string }>,
  model: LocalModel,
): Promise<number> {
  const recentTasksText = recentTasks.map((t) => `- ${t.title}`).join('\n') || '(なし)';
  const existingIdeasText = existingIdeas.map((i) => `- ${i.title}`).join('\n') || '(なし)';
  const prompt = INNOVATION_PROMPT.replace('{project}', theme.name)
    .replace('{recentTasks}', recentTasksText)
    .replace('{existingIdeas}', existingIdeasText);

  let response;
  try {
    response = await sendAIMessage({
      provider: model.provider,
      model: model.name,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 700,
    });
  } catch (err) {
    log.warn({ err, themeId: theme.id }, 'Innovation generation failed for theme');
    return 0;
  }

  const jsonMatch = response.content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return 0;

  let ideas: Array<{ title: string; content: string }>;
  try {
    ideas = (JSON.parse(jsonMatch[0]) as Array<{ title: string; content: string }>)
      .filter((i) => i.title && i.content)
      .slice(0, IDEAS_PER_THEME);
  } catch {
    return 0;
  }

  let created = 0;
  for (const idea of ideas) {
    // themeId → submitIdea derives scope 'project', so the idea is tied to this
    // project rather than the old global bucket.
    await submitIdea({
      title: idea.title,
      content: idea.content,
      source: 'innovation_session',
      scope: 'project',
      themeId: theme.id,
      confidence: 0.75,
    });
    created++;
  }
  return created;
}

/**
 * Run an innovation session across each eligible project. Every idea produced
 * is tied to its project (no global ideas).
 *
 * @returns Number of ideas generated / 生成されたアイデア数
 */
export async function runInnovationSession(): Promise<number> {
  log.info('Starting innovation session');

  const now = new Date();
  const since = lastRunAt ?? new Date(now.getTime() - SESSION_INTERVAL_MS);

  // Only configured projects (working directory) that aren't disabled for
  // innovation. Periodic jobs target specified repositories, and every idea
  // must tie to a theme — so theme-less / unconfigured work is not used here.
  const disabled = await getDisabledThemeIds('innovation');
  const themes = await prisma.theme.findMany({
    where: {
      workingDirectory: { not: null },
      ...(disabled.size > 0 ? { id: { notIn: [...disabled] } } : {}),
    },
    select: { id: true, name: true },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  });
  if (themes.length === 0) {
    log.info('No eligible projects for innovation');
    lastRunAt = now;
    return 0;
  }

  const localStatus = await getLocalLLMStatus().catch(() => ({ available: false }));
  const useLocal = (localStatus as { available: boolean }).available;
  const model: LocalModel = useLocal
    ? { provider: 'ollama', name: await getBestLocalModel() }
    : { provider: 'claude', name: 'claude-haiku-4-5-20251001' };

  let created = 0;
  let processed = 0;
  for (const theme of themes) {
    if (processed >= MAX_THEMES) break;

    const recentTasks = await prisma.task.findMany({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: since },
        parentId: null,
        themeId: theme.id,
      },
      select: { title: true, description: true },
      orderBy: { completedAt: 'desc' },
      take: 15,
    });
    if (recentTasks.length < MIN_COMPLETIONS_PER_THEME) continue;
    processed++;

    const existingIdeas = await prisma.knowledgeEntry.findMany({
      where: { sourceType: 'idea_box', forgettingStage: 'active', themeId: theme.id },
      select: { title: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    created += await generateForTheme(theme, recentTasks, existingIdeas, model);
  }

  log.info({ created, projects: processed }, 'Innovation session complete');
  lastRunAt = now;
  return created;
}

