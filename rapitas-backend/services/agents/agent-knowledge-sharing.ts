/**
 * AgentKnowledgeSharing
 *
 * Injects learning results (success/failure patterns, prompt evolutions) from
 * previous agent executions as context for new agent runs.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('agent-knowledge-sharing');

interface SharedKnowledge {
  patterns: Array<{
    id: number;
    type: string;
    category: string;
    description: string;
    actions: string[];
    confidence: number;
    occurrences: number;
  }>;
  relevantKnowledge: Array<{
    id: number;
    title: string;
    content: string;
    category: string;
    confidence: number;
  }>;
  promptEvolutions: Array<{
    category: string;
    improvement: string;
    performanceDelta: number;
  }>;
  warnings: string[];
}

/**
 * Gather relevant learning patterns and knowledge as context before task execution.
 *
 * @param taskId - Target task ID / 対象タスクID
 * @returns Shared knowledge context / 共有知識コンテキスト
 */
export async function gatherSharedKnowledge(taskId: number): Promise<SharedKnowledge> {
  const result: SharedKnowledge = {
    patterns: [],
    relevantKnowledge: [],
    promptEvolutions: [],
    warnings: [],
  };

  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        theme: true,
        taskLabels: { include: { label: true } },
      },
    });

    if (!task) return result;

    result.patterns = await findRelevantPatterns(task);
    result.relevantKnowledge = await findRelevantKnowledgeForAgent(task);
    result.promptEvolutions = await getLatestPromptEvolutions();
    result.warnings = await generateWarnings(task);

    log.info(
      {
        taskId,
        patterns: result.patterns.length,
        knowledge: result.relevantKnowledge.length,
        evolutions: result.promptEvolutions.length,
        warnings: result.warnings.length,
      },
      'Shared knowledge gathered for task execution',
    );
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to gather shared knowledge');
  }

  return result;
}

/**
 * Convert shared knowledge into prompt text for injection during agent execution.
 */
export function formatKnowledgeContext(knowledge: SharedKnowledge): string {
  const sections: string[] = [];

  // Warnings take highest priority
  if (knowledge.warnings.length > 0) {
    sections.push(
      '⚠️ 過去の失敗パターンに基づく警告:\n' + knowledge.warnings.map((w) => `- ${w}`).join('\n'),
    );
  }

  const successPatterns = knowledge.patterns.filter((p) => p.type === 'success_strategy');
  if (successPatterns.length > 0) {
    sections.push(
      '✅ 過去の成功パターン:\n' +
        successPatterns
          .map(
            (p) =>
              `- ${p.description} (信頼度: ${Math.round(p.confidence * 100)}%, ${p.occurrences}回確認)`,
          )
          .join('\n'),
    );
  }

  if (knowledge.relevantKnowledge.length > 0) {
    sections.push(
      '📚 関連する既存ナレッジ:\n' +
        knowledge.relevantKnowledge
          .map((k) => `- [${k.category}] ${k.title}: ${k.content.slice(0, 150)}`)
          .join('\n'),
    );
  }

  if (sections.length === 0) return '';

  return (
    '\n--- 学習データに基づくコンテキスト ---\n' +
    sections.join('\n\n') +
    '\n--- コンテキスト終了 ---\n'
  );
}

/**
 * Update learning patterns after agent execution completes.
 */
export async function updatePatternsFromExecution(
  taskId: number,
  success: boolean,
  executionId: number,
): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        taskLabels: { include: { label: true } },
      },
    });

    if (!task) return;

    const category = inferTaskCategory(
      task.title,
      task.taskLabels.map((tl) => tl.label.name),
    );

    if (success) {
      await upsertPattern({
        patternType: 'success_strategy',
        category,
        description: `${task.title}の実行パターン`,
        conditions: JSON.stringify({
          titleKeywords: extractKeywords(task.title),
          labels: task.taskLabels.map((tl) => tl.label.name),
          themeId: task.themeId,
        }),
        actions: JSON.stringify([`タスク「${task.title}」で成功した手法を適用`]),
        executionId,
      });
    } else {
      const execution = await prisma.agentExecution.findUnique({
        where: { id: executionId },
        select: { errorMessage: true },
      });

      await upsertPattern({
        patternType: 'failure_pattern',
        category,
        description: `${task.title}での失敗: ${execution?.errorMessage?.slice(0, 100) || '不明なエラー'}`,
        conditions: JSON.stringify({
          titleKeywords: extractKeywords(task.title),
          errorType: execution?.errorMessage?.slice(0, 50),
        }),
        actions: JSON.stringify(
          [
            '同様のタスクでは注意が必要',
            execution?.errorMessage ? `エラー内容: ${execution.errorMessage.slice(0, 200)}` : '',
          ].filter(Boolean),
        ),
        executionId,
      });
    }

    log.info({ taskId, success, executionId }, 'Patterns updated from execution');
  } catch (error) {
    log.error({ err: error, taskId }, 'Failed to update patterns from execution');
  }
}

// ──── Internal helpers ────

async function findRelevantPatterns(task: {
  title: string;
  themeId: number | null;
  taskLabels: Array<{ label: { name: string } }>;
}) {
  const keywords = extractKeywords(task.title);
  const labels = task.taskLabels.map((tl) => tl.label.name);

  const patterns = await prisma.learningPattern.findMany({
    where: {
      confidence: { gte: 0.4 },
    },
    orderBy: [{ occurrences: 'desc' }, { confidence: 'desc' }],
    take: 30,
  });

  // Filter and rank by relevance
  return patterns
    .map((p) => {
      let relevance = 0;
      try {
        const conditions = JSON.parse(p.conditions);

        if (conditions.titleKeywords) {
          const matchCount = (conditions.titleKeywords as string[]).filter((kw: string) =>
            keywords.includes(kw),
          ).length;
          relevance += matchCount * 10;
        }

        if (conditions.labels) {
          const matchCount = (conditions.labels as string[]).filter((l: string) =>
            labels.includes(l),
          ).length;
          relevance += matchCount * 15;
        }

        if (conditions.themeId && conditions.themeId === task.themeId) {
          relevance += 20;
        }

        const taskCategory = inferTaskCategory(task.title, labels);
        if (p.category === taskCategory) {
          relevance += 10;
        }
      } catch {
        // NOTE: On conditions parse failure, fall back to category match only
        const taskCategory = inferTaskCategory(task.title, labels);
        if (p.category === taskCategory) relevance += 10;
      }

      return { pattern: p, relevance };
    })
    .filter((item) => item.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5)
    .map((item) => ({
      id: item.pattern.id,
      type: item.pattern.patternType,
      category: item.pattern.category,
      description: item.pattern.description,
      actions: (() => {
        try {
          return JSON.parse(item.pattern.actions);
        } catch {
          return [];
        }
      })(),
      confidence: item.pattern.confidence,
      occurrences: item.pattern.occurrences,
    }));
}

async function findRelevantKnowledgeForAgent(task: {
  title: string;
  themeId: number | null;
  description: string | null;
}) {
  const keywords = extractKeywords(`${task.title} ${task.description || ''}`);

  if (keywords.length === 0) return [];

  const entries = await prisma.knowledgeEntry.findMany({
    where: {
      forgettingStage: { in: ['active', 'dormant'] },
      confidence: { gte: 0.5 },
      OR: keywords.slice(0, 4).map((kw) => ({
        OR: [
          { title: { contains: kw, mode: 'insensitive' as const } },
          { content: { contains: kw, mode: 'insensitive' as const } },
        ],
      })),
    },
    select: {
      id: true,
      title: true,
      content: true,
      category: true,
      confidence: true,
      themeId: true,
    },
    orderBy: [{ confidence: 'desc' }, { decayScore: 'desc' }],
    take: 5,
  });

  // Prioritize theme matches
  return entries
    .sort((a, b) => {
      const aBonus = a.themeId === task.themeId ? 100 : 0;
      const bBonus = b.themeId === task.themeId ? 100 : 0;
      return bBonus + b.confidence * 10 - (aBonus + a.confidence * 10);
    })
    .slice(0, 3)
    .map((e) => ({
      id: e.id,
      title: e.title,
      content: e.content.slice(0, 300),
      category: e.category,
      confidence: e.confidence,
    }));
}

async function getLatestPromptEvolutions() {
  const evolutions = await prisma.promptEvolution.findMany({
    where: { performanceDelta: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      category: true,
      improvement: true,
      performanceDelta: true,
    },
  });

  return evolutions.map((e) => ({
    category: e.category,
    improvement: e.improvement || '',
    performanceDelta: e.performanceDelta,
  }));
}

async function generateWarnings(task: {
  title: string;
  themeId: number | null;
  taskLabels: Array<{ label: { name: string } }>;
}): Promise<string[]> {
  const warnings: string[] = [];
  const keywords = extractKeywords(task.title);

  const failurePatterns = await prisma.learningPattern.findMany({
    where: {
      patternType: { in: ['failure_pattern', 'anti_pattern'] },
      confidence: { gte: 0.5 },
      occurrences: { gte: 2 },
    },
    orderBy: { occurrences: 'desc' },
    take: 20,
  });

  for (const pattern of failurePatterns) {
    try {
      const conditions = JSON.parse(pattern.conditions);

      if (conditions.titleKeywords) {
        const matchCount = (conditions.titleKeywords as string[]).filter((kw: string) =>
          keywords.includes(kw),
        ).length;

        if (matchCount >= 2) {
          warnings.push(
            `${pattern.description}（${pattern.occurrences}回発生、信頼度${Math.round(pattern.confidence * 100)}%）`,
          );
        }
      }

      const taskCategory = inferTaskCategory(
        task.title,
        task.taskLabels.map((tl) => tl.label.name),
      );
      if (pattern.category === taskCategory && !conditions.titleKeywords) {
        warnings.push(`[${taskCategory}] ${pattern.description}`);
      }
    } catch {
      // ignore
    }
  }

  return warnings.slice(0, 3);
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'の',
    'を',
    'に',
    'は',
    'が',
    'で',
    'と',
    'する',
    'した',
    'です',
    'ます',
    'a',
    'an',
    'the',
    'is',
    'are',
    'for',
    'and',
    'or',
    'but',
    'in',
    'on',
    'at',
    'to',
    'from',
    'by',
    'with',
    'as',
    'of',
    'add',
    'update',
    'fix',
  ]);

  return text
    .toLowerCase()
    .split(/[\s\-_\/\\:;,.\(\)\[\]{}]+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w))
    .slice(0, 10);
}

function inferTaskCategory(title: string, labels: string[]): string {
  const text = `${title} ${labels.join(' ')}`.toLowerCase();

  if (text.match(/bug|fix|修正|エラー|error|不具合/)) return 'bug_fix';
  if (text.match(/feature|機能|実装|implement|新規/)) return 'feature_implementation';
  if (text.match(/refactor|リファクタ|整理|cleanup/)) return 'refactoring';
  if (text.match(/test|テスト|spec/)) return 'testing';
  if (text.match(/debug|デバッグ|調査|investigate/)) return 'debugging';

  return 'feature_implementation';
}

async function upsertPattern(input: {
  patternType: string;
  category: string;
  description: string;
  conditions: string;
  actions: string;
  executionId: number;
}): Promise<void> {
  const existing = await prisma.learningPattern.findFirst({
    where: {
      patternType: input.patternType,
      category: input.category,
      description: { contains: input.description.slice(0, 30) },
    },
  });

  if (existing) {
    const newConfidence = Math.min(1.0, existing.confidence + 0.05 * (1 - existing.confidence));

    await prisma.learningPattern.update({
      where: { id: existing.id },
      data: {
        occurrences: { increment: 1 },
        confidence: newConfidence,
        lastObserved: new Date(),
        metadata: JSON.stringify({
          ...(() => {
            try {
              return JSON.parse(existing.metadata);
            } catch {
              return {};
            }
          })(),
          lastExecutionId: input.executionId,
        }),
      },
    });
  } else {
    await prisma.learningPattern.create({
      data: {
        patternType: input.patternType,
        category: input.category,
        description: input.description.slice(0, 500),
        conditions: input.conditions,
        actions: input.actions,
        confidence: 0.5,
        occurrences: 1,
        metadata: JSON.stringify({ executionId: input.executionId }),
      },
    });
  }
}
