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
import { parseJsonArray } from '../../utils/common/json-extractor';
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

/**
 * Stakeholder personas rotated across runs (R3). Persona conditioning steers
 * generation into different regions of the model's knowledge — a measurably
 * stronger diversity axis than sampling temperature (Persona Hub,
 * arXiv:2406.20094; temperature correlates with incoherence, not novelty,
 * arXiv:2405.00492).
 */
export const IDEATION_PERSONAS = [
  'エンドユーザー（毎日このプロダクトで作業する人。手数と迷いを減らしたい）',
  'SRE・運用者（安定稼働・可観測性・障害からの回復を最優先する人）',
  'セキュリティ監査者（悪用・情報漏えい・権限の穴を探す人）',
  '初日の新規ユーザー（今日中に価値を感じたい。学習コストに敏感）',
  'アクセシビリティ利用者（キーボード操作・スクリーンリーダー・色覚多様性の観点）',
  'データアナリスト（蓄積されたデータから意思決定に効く洞察を得たい人）',
] as const;

/**
 * Deterministic persona rotation. Pure and testable.
 *
 * @param seed - Any integer (e.g. themeId + day-of-year). / 回転シード
 * @returns One persona string. / ペルソナ
 */
export function pickPersona(seed: number): string {
  return IDEATION_PERSONAS[Math.abs(Math.trunc(seed)) % IDEATION_PERSONAS.length];
}

const INNOVATION_PROMPT = `あなたはプロダクトイノベーターです。
今回は特に **{persona}** の視点に立って考えてください。
対象プロジェクトの情報から、既存機能の「組み合わせ」や「転用」で生まれる
新しい価値を提案してください。改善やバグ修正ではなく、斬新なアイデアを求めています。

## 思考フレームワーク
- 既存機能AをBの文脈で使うとどうなるか？（機能の転用）
- 列挙された「未解決の懸念」は、新機能や新体験で根本から解消できないか？（課題→機会の転換）
- ユーザーがまだ気づいていない潜在ニーズは？
- 競合にない、このプロジェクトだからこそ可能な体験は？
- 「もし〇〇ができたら」という仮説的な提案
- 異分野（ゲーム、SNS、教育、ヘルスケア）のパターンを取り入れられないか？

## 多様性の強制（最重要）
「最近完了したタスク」と「既存アイデア」が特定の技術テーマ（例: リファクタリング、型安全/型ガード、SSOT、テスト基盤）に**偏っている**場合、その同じテーマの提案は**禁止**する。プロジェクトは同じ領域を延々と作り直すのではなく、**未開拓の領域**へ広げる必要がある。最近のタスクと**異なるドメイン**から提案せよ:
- ユーザー体験・UI/UX、可視化・ダッシュボード
- 外部連携・API・自動化ワークフロー
- データ活用・分析・レコメンド
- パフォーマンス・信頼性の体験面での価値
- まだ誰も触れていないユーザー課題
最近のタスクと同じ技術領域（同じファイル群を触る類似リファクタ等）の提案は価値ゼロとみなす。

## 禁止
- 「〇〇を改善する」「〇〇のバグを修正する」系の改善提案（それは懸念バックログの役割）
- 既に存在する機能・既存アイデアの繰り返し
- **最近のタスクと同じテーマ・同じ技術領域の繰り返し（上記「多様性の強制」参照）**
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

## 出力（Verbalized Sampling — 分布ごと出力する）
アイデア候補を**互いに方向性の異なる5件**、それぞれに typicality（典型度）を付けてJSON配列で返してください（他のテキスト不要）:
[{"title":"斬新なタイトル","content":"具体的な説明。何が新しく、なぜユーザーに価値があるか","typicality":0.0}]

typicality = 「同じ入力を与えられた平均的なAIがその案を思いつく確率」の自己推定（0.0〜1.0）。
ありきたり・定番の案ほど高く（0.7〜）、独創的で意外な案ほど低く（〜0.3）付けてください。
採用はシステム側で**低typicality優先**で行うので、高typicalityの案も正直に高く申告して構いません。

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
 * @param persona - Stakeholder persona to ideate as. / 発想の視点ペルソナ
 * @returns The filled prompt / 完成したプロンプト
 */
export function buildInnovationPrompt(
  projectName: string,
  signals: ThemeSignals,
  persona: string = IDEATION_PERSONAS[0],
): string {
  const recentTasksText =
    signals.completedTasks.length > 0
      ? signals.completedTasks.map((t) => `- ${t.title}`).join('\n')
      : '(なし)';
  return INNOVATION_PROMPT.replace('{persona}', persona)
    .replace('{project}', projectName)
    .replace('{recentTasks}', recentTasksText)
    .replace('{concerns}', bullets(signals.openConcerns))
    .replace('{backlog}', bullets(signals.backlogTasks))
    .replace('{existingIdeas}', bullets(signals.existingIdeas));
}

/**
 * Pick the low-typicality tail of a verbalized-sampling candidate set (R3):
 * candidates the model itself rates as less typical are the semantically
 * novel modes that temperature cannot reach (arXiv:2510.01171). Missing
 * typicality is treated as neutral 0.5 so plain (pre-VS) replies still work.
 *
 * @param candidates - Parsed candidates. / 候補
 * @param n - How many to keep. / 採用数
 * @returns Valid candidates, least-typical first. / 低典型度順の採用分
 */
export function selectTailCandidates<
  T extends { title?: string; content?: string; typicality?: number },
>(candidates: T[], n: number): T[] {
  return candidates
    .filter((c) => c.title && c.content)
    .sort((a, b) => (a.typicality ?? 0.5) - (b.typicality ?? 0.5))
    .slice(0, n);
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
  // Rotate persona by theme AND calendar day so consecutive daily runs view
  // the same project through different stakeholder lenses.
  const dayOfYear = Math.floor(Date.now() / 86_400_000);
  const persona = pickPersona(theme.id + dayOfYear);
  const prompt = buildInnovationPrompt(theme.name, signals, persona);

  let response;
  try {
    response = await sendAIMessage({
      provider: model.provider,
      model: model.name,
      messages: [{ role: 'user', content: prompt }],
      // 5 verbalized-sampling candidates need more room than the old 1-3.
      maxTokens: 1600,
    });
  } catch (err) {
    log.warn({ err, themeId: theme.id }, 'Innovation generation failed for theme');
    return 0;
  }

  const parsedIdeas = parseJsonArray<{ title: string; content: string; typicality?: number }>(
    response.content,
  );
  if (!parsedIdeas) return 0;

  // Verbalized sampling: keep the LOW-typicality tail of the candidate set.
  const ideas = selectTailCandidates(parsedIdeas, IDEAS_PER_THEME);

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
