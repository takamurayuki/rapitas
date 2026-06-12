/**
 * Innovation Session
 *
 * Periodically generates novel, cross-cutting ideas per project from a "product
 * innovator" perspective, filing them into the idea box (scope 'project').
 *
 * Earlier this only ran for a theme that had a task COMPLETED since the last run
 * — a scarce signal — and fed the model only recent task TITLES, so it almost
 * always produced nothing (while the concern scan, keyed off the always-present
 * git diff, filed steadily). This version ideates from a RICHER, more abundant
 * signal: recent completions (generous look-back) + the OPEN concern backlog
 * (pain points → opportunities) + the active task backlog. A theme is ideated
 * whenever ANY of those exist, not only on fresh completions.
 *
 * Unlike the improvement-focused idea extractor, this targets creative
 * recombination and latent user needs.
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
 * Look-back for "recent completions". Fixed and generous (not "since last run")
 * so the engine reconsiders a project with real context periodically — dedup by
 * content hash (submitIdea) prevents repeats, so a wide window is safe.
 */
const COMPLETION_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Max projects processed per run — bounds LLM cost. */
const MAX_THEMES = 5;
/** Max ideas kept per project per run. */
const IDEAS_PER_THEME = 3;
/** Per-signal sample caps fed to the model. */
const MAX_COMPLETED = 15;
const MAX_CONCERNS = 8;
const MAX_BACKLOG = 8;
const MAX_EXISTING_IDEAS = 25;

const INNOVATION_PROMPT = `あなたはプロダクトイノベーターです。
対象プロジェクトの情報から、既存機能の「組み合わせ」や「転用」で生まれる
新しい価値を提案してください。改善やバグ修正ではなく、斬新なアイデアを求めています。

## 思考フレームワーク
- 既存機能AをBの文脈で使うとどうなるか？（機能の転用）
- 列挙された「未解決の懸念」は、新機能や新体験で根本から解消できないか？（課題→機会の転換）
- ユーザーがまだ気づいていない潜在ニーズは？
- 競合にない、このプロジェクトだからこそ可能な体験は？
- 「もし〇〇ができたら」という仮説的な提案
- 異分野（ゲーム、SNS、教育、ヘルスケア）のパターンを取り入れられないか？

## 禁止
- 「〇〇を改善する」「〇〇のバグを修正する」系の改善提案（それは懸念バックログの役割）
- 既に存在する機能・既存アイデアの繰り返し
- 抽象的すぎて実行できない提案（「AIを活用する」等）

## 対象プロジェクト
{project}

## 最近完了したタスク（このプロジェクトが何をしてきたか）
{recentTasks}

## 未解決の懸念（課題・痛点 — 機会の源泉）
{concerns}

## 現在のバックログ（進行中・予定のタスク）
{backlog}

## 既存アイデア（重複回避）
{existingIdeas}

新しいアイデアを1〜3件、JSON配列で返してください（他のテキスト不要）:
[{"title":"斬新なタイトル","content":"具体的な説明。何が新しく、なぜユーザーに価値があるか"}]

本当に新しいアイデアがなければ空配列 [] を返してください。無理に数を合わせないでください。`;

interface LocalModel {
  provider: 'ollama' | 'claude';
  name: string;
}

/** The signals gathered for one theme, used to decide eligibility + build the prompt. */
export interface ThemeSignals {
  completedTasks: Array<{ title: string; description: string | null }>;
  openConcerns: Array<{ title: string }>;
  backlogTasks: Array<{ title: string }>;
  existingIdeas: Array<{ title: string }>;
}

/** True when a theme has ANY signal worth ideating from. */
export function hasInnovationSignal(s: ThemeSignals): boolean {
  return s.completedTasks.length > 0 || s.openConcerns.length > 0 || s.backlogTasks.length > 0;
}

/** Renders a list of titles as a markdown bullet list, or "(なし)" when empty. */
function bullets(items: Array<{ title: string }>): string {
  return items.length > 0 ? items.map((i) => `- ${i.title}`).join('\n') : '(なし)';
}

/**
 * Build the innovation prompt for one theme from its gathered signals. Pure —
 * the session's testable core.
 *
 * @param projectName - Theme name / プロジェクト名
 * @param signals - Gathered signals / 収集した信号
 * @returns The filled prompt / 完成したプロンプト
 */
export function buildInnovationPrompt(projectName: string, signals: ThemeSignals): string {
  const recentTasksText =
    signals.completedTasks.length > 0
      ? signals.completedTasks.map((t) => `- ${t.title}`).join('\n')
      : '(なし)';
  return INNOVATION_PROMPT.replace('{project}', projectName)
    .replace('{recentTasks}', recentTasksText)
    .replace('{concerns}', bullets(signals.openConcerns))
    .replace('{backlog}', bullets(signals.backlogTasks))
    .replace('{existingIdeas}', bullets(signals.existingIdeas));
}

/** Gathers the ideation signals for one theme. */
async function gatherThemeSignals(themeId: number, completionsSince: Date): Promise<ThemeSignals> {
  const [completedTasks, openConcerns, backlogTasks, existingIdeas] = await Promise.all([
    prisma.task.findMany({
      where: {
        status: { in: ['done', 'completed'] },
        completedAt: { gte: completionsSince },
        parentId: null,
        themeId,
      },
      select: { title: true, description: true },
      orderBy: { completedAt: 'desc' },
      take: MAX_COMPLETED,
    }),
    // Open concerns: sourceType 'concern', sourceId 'open' (the lifecycle marker).
    prisma.knowledgeEntry.findMany({
      where: { sourceType: 'concern', sourceId: 'open', themeId },
      select: { title: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONCERNS,
    }),
    prisma.task.findMany({
      where: { status: { in: ['todo', 'in-progress'] }, parentId: null, themeId },
      select: { title: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_BACKLOG,
    }),
    prisma.knowledgeEntry.findMany({
      where: { sourceType: 'idea_box', forgettingStage: 'active', themeId },
      select: { title: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_EXISTING_IDEAS,
    }),
  ]);
  return { completedTasks, openConcerns, backlogTasks, existingIdeas };
}

/** Generates and files project-scoped ideas for one theme. Returns the count. */
async function generateForTheme(
  theme: { id: number; name: string },
  signals: ThemeSignals,
  model: LocalModel,
): Promise<number> {
  const prompt = buildInnovationPrompt(theme.name, signals);

  let response;
  try {
    response = await sendAIMessage({
      provider: model.provider,
      model: model.name,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 900,
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
    // project rather than the old global bucket. Dedups by content hash.
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

  const completionsSince = new Date(Date.now() - COMPLETION_LOOKBACK_MS);

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

    const signals = await gatherThemeSignals(theme.id, completionsSince);
    // Skip only a truly empty project (no completions, no concerns, no backlog) —
    // otherwise ideate. This replaces the old "no fresh completions → skip" gate
    // that starved the idea box.
    if (!hasInnovationSignal(signals)) continue;
    processed++;

    created += await generateForTheme(theme, signals, model);
  }

  log.info({ created, projects: processed }, 'Innovation session complete');
  return created;
}
