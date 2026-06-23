/**
 * retrospective-service
 *
 * Generates a *grounded* task retrospective from the real workflow artifacts
 * (research.md / plan.md / verify.md) plus the task outcome, then persists the
 * carry-forward lessons into the knowledge OS so future tasks (agents and the
 * copilot) automatically benefit. This is the "deep dive into what we actually
 * learned" — distinct from the generic copilot chat which only sees task
 * metadata.
 */
import { createHash } from 'crypto';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveWorkflowDir, readWorkflowFile } from '../workflow/workflow-file-utils';
import { sendAIMessage } from '../../utils/ai-client';
import type { AIProvider } from '../../utils/ai-client';
import { selectBestModel } from './model-discovery';
import { TASK_NOT_FOUND } from '../../utils/common/error-messages';

const log = createLogger('retrospective-service');

/**
 * Last-resort model id, used ONLY when live discovery returns nothing. We do not
 * hardcode the primary model — see selectBestModel below — because static ids
 * break when the provider's snapshot date changes.
 */
const RETRO_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';
/** Cap on lessons persisted per retrospective to avoid knowledge-base noise. */
const MAX_LESSONS_SAVED = 5;
/** Per-artifact char budget injected into the prompt. */
const ARTIFACT_CHAR_LIMIT = 4000;

export interface RetrospectiveResult {
  /** Formatted markdown for display in the copilot. */
  markdown: string;
  /** Number of carry-forward lessons saved to the knowledge OS. */
  savedLessons: number;
  /** Which workflow artifacts were available and used. */
  usedArtifacts: string[];
}

interface RetrospectiveJson {
  summary?: string;
  wentWell?: string[];
  learnings?: string[];
  carryForward?: string[];
}

const SYSTEM_PROMPT = `あなたはソフトウェア開発の振り返り（レトロスペクティブ）アナリストです。
与えられたタスクの実際の成果物（調査・計画・検証）と結果をもとに、実装を通じて得られた
学びを深掘りし、次のタスクで再利用できる教訓を抽出します。

必ず次のJSONのみを出力してください（前後に説明文やコードフェンスを付けない）:
{
  "summary": "1-2文の総括",
  "wentWell": ["うまくいった点", ...],
  "learnings": ["実装中に発見した学び（計画と実装の差分・ハマりどころ・想定外）", ...],
  "carryForward": ["次のタスクで活かせる、具体的で再利用可能な教訓", ...]
}
日本語で、各配列は最大5項目、各項目は簡潔かつ具体的に。`;

/** Maps a discovery Provider to the ai-client's AIProvider (openai → chatgpt). */
function toAIProvider(p: 'claude' | 'openai' | 'gemini' | 'ollama'): AIProvider {
  return p === 'openai' ? 'chatgpt' : p;
}

/** Truncates long text with an elision marker. */
function clip(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}\n…(以下省略)` : s;
}

/** Extracts the first JSON object from a model response, tolerating code fences. */
function parseJsonLoose(text: string): RetrospectiveJson | null {
  const fenced = text.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as RetrospectiveJson;
  } catch {
    return null;
  }
}

/** Renders the parsed retrospective as display markdown. */
function buildMarkdown(j: RetrospectiveJson): string {
  const lines: string[] = ['# 振り返り'];
  if (j.summary) lines.push('', j.summary);
  const section = (title: string, items?: string[]) => {
    if (items && items.length > 0) {
      lines.push('', `## ${title}`, ...items.map((x) => `- ${x}`));
    }
  };
  section('うまくいった点', j.wentWell);
  section('実装中に発見した学び', j.learnings);
  section('次のタスクに活かせる教訓', j.carryForward);
  return lines.join('\n');
}

/**
 * Persists carry-forward lessons as KnowledgeEntry rows so gatherSharedKnowledge
 * surfaces them to future tasks. Dedupes by content hash.
 */
async function persistLessons(
  lessons: string[],
  taskId: number,
  themeId: number | null,
  taskTitle: string,
): Promise<number> {
  let saved = 0;
  for (const raw of lessons.slice(0, MAX_LESSONS_SAVED)) {
    const content = raw.trim();
    if (!content) continue;
    const contentHash = createHash('sha256').update(content).digest('hex');
    const existing = await prisma.knowledgeEntry.findFirst({ where: { contentHash } });
    if (existing) continue;
    await prisma.knowledgeEntry.create({
      data: {
        sourceType: 'retrospective',
        sourceId: String(taskId),
        title: `振り返りの学び: ${taskTitle}`.slice(0, 120),
        content,
        contentHash,
        category: 'insight',
        // Above the gatherSharedKnowledge confidence floor (0.5) so it surfaces.
        confidence: 0.7,
        themeId: themeId ?? undefined,
        taskId,
      },
    });
    saved++;
  }
  return saved;
}

/**
 * Generates a grounded retrospective for a completed task and stores its
 * carry-forward lessons in the knowledge OS.
 *
 * @param taskId - Task to reflect on / 振り返り対象のタスクID
 * @returns Retrospective markdown + how many lessons were saved / 振り返りと保存件数
 * @throws {Error} When the task does not exist / タスクが存在しない場合
 */
export async function generateTaskRetrospective(taskId: number): Promise<RetrospectiveResult> {
  const resolved = await resolveWorkflowDir(taskId);
  if (!resolved) throw new Error(TASK_NOT_FOUND);
  const { task, dir, themeId } = resolved;

  const [research, plan, verify] = await Promise.all([
    readWorkflowFile(dir, 'research'),
    readWorkflowFile(dir, 'plan'),
    readWorkflowFile(dir, 'verify'),
  ]);
  const usedArtifacts = [
    research ? 'research.md' : null,
    plan ? 'plan.md' : null,
    verify ? 'verify.md' : null,
  ].filter((x): x is string => x !== null);

  const subtaskRow = await prisma.task.findUnique({
    where: { id: taskId },
    select: { subtasks: { select: { title: true, status: true } } },
  });
  const learning = await prisma.workflowLearningRecord.findFirst({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
    select: {
      workflowMode: true,
      actualDurationMinutes: true,
      predictedComplexity: true,
      outcome: true,
    },
  });

  const contextParts: string[] = [
    `## タスク: ${task.title}`,
    task.description ? `説明: ${clip(task.description, 600)}` : '',
    `ステータス: ${task.status} / 複雑度: ${task.complexityScore ?? '未算出'} / モード: ${
      task.workflowMode ?? '未設定'
    }`,
  ];
  if (subtaskRow?.subtasks.length) {
    contextParts.push(
      `サブタスク(${subtaskRow.subtasks.length}): ${subtaskRow.subtasks
        .map((s) => `[${s.status}] ${s.title}`)
        .join(', ')}`,
    );
  }
  if (learning) {
    contextParts.push(
      `実行結果: ${learning.outcome}${
        learning.actualDurationMinutes ? ` / 所要 ${learning.actualDurationMinutes}分` : ''
      }`,
    );
  }
  if (research) contextParts.push(`\n## research.md\n${clip(research, ARTIFACT_CHAR_LIMIT)}`);
  if (plan) contextParts.push(`\n## plan.md\n${clip(plan, ARTIFACT_CHAR_LIMIT)}`);
  if (verify) contextParts.push(`\n## verify.md\n${clip(verify, ARTIFACT_CHAR_LIMIT)}`);

  const userPrompt = `${contextParts
    .filter(Boolean)
    .join('\n')}\n\n上記のタスクの振り返りを、指定のJSON形式で出力してください。`;

  const aiBase = {
    messages: [{ role: 'user' as const, content: userPrompt }],
    systemPrompt: SYSTEM_PROMPT,
    maxTokens: 1500,
  };
  // Pick a model that the configured keys actually expose right now (probed
  // live and cached), preferring a strong Claude tier. Discovery auto-downgrades
  // tiers/providers, so this never sends a stale hardcoded id.
  const picked = await selectBestModel({ desiredTier: 'standard', preferredProvider: 'claude' });
  let response;
  try {
    if (!picked) throw new Error('利用可能なモデルが見つかりません');
    response = await sendAIMessage({
      ...aiBase,
      provider: toAIProvider(picked.model.provider),
      model: picked.model.id,
    });
  } catch (err) {
    log.warn(
      { err, taskId, fallback: RETRO_FALLBACK_MODEL },
      'Model selection failed; using last-resort fallback',
    );
    response = await sendAIMessage({ ...aiBase, provider: 'claude', model: RETRO_FALLBACK_MODEL });
  }

  const parsed = parseJsonLoose(response.content);
  if (!parsed) {
    log.warn({ taskId }, 'Retrospective JSON parse failed; returning raw content');
    const raw = response.content.trim();
    await saveRetrospectiveMessage(taskId, raw);
    return { markdown: raw, savedLessons: 0, usedArtifacts };
  }

  const savedLessons = await persistLessons(parsed.carryForward ?? [], taskId, themeId, task.title);

  let markdown = buildMarkdown(parsed);
  if (savedLessons > 0) {
    markdown += `\n\n> ${savedLessons}件の学びをナレッジに保存しました（今後のタスクに自動で活かされます）。`;
  }
  if (usedArtifacts.length === 0) {
    markdown +=
      '\n\n> 注: ワークフロー成果物（research/plan/verify.md）が見つからなかったため、タスク情報のみから生成しています。';
  }

  // Persist the retrospective as a copilot message so it re-appears in the
  // panel history on subsequent visits.
  await saveRetrospectiveMessage(taskId, markdown);

  log.info({ taskId, savedLessons, usedArtifacts }, 'Generated task retrospective');
  return { markdown, savedLessons, usedArtifacts };
}

/** Saves the retrospective as an assistant copilot message (non-fatal on error). */
async function saveRetrospectiveMessage(taskId: number, content: string): Promise<void> {
  try {
    await prisma.copilotMessage.create({ data: { taskId, role: 'assistant', content } });
  } catch (err) {
    log.warn({ err, taskId }, 'Failed to persist retrospective message');
  }
}
