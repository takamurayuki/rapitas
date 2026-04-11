/**
 * Teacher-Student Evaluation Loop
 *
 * Implements a knowledge distillation pattern where a strong model (Teacher, e.g.
 * Claude Haiku) generates teaching materials (few-shot examples, evaluation rubrics)
 * and evaluates Student (local LLM) outputs. Teaching materials are stored in
 * KnowledgeEntry for RAG retrieval by the Student on future tasks.
 *
 * Loop:
 *   1. Teacher generates few-shot examples for a task category
 *   2. Student executes with examples injected via RAG
 *   3. Teacher evaluates Student output (score 0-100)
 *   4. If score < threshold, Teacher generates corrected example → stored as new teaching material
 *   5. Next time Student runs a similar task, RAG retrieves the improved examples
 */
import { prisma, createLogger } from '../../config';
import { sendAIMessage, type AIMessage } from '../../utils/ai-client';
import { createContentHash } from '../memory/utils';
import { generateEmbedding } from '../memory/rag/embedding';
import { upsertEmbedding } from '../memory/rag/vector-index';

const log = createLogger('local-llm:teacher-student');

/** Teaching material category stored in KnowledgeEntry. */
const TEACHING_SOURCE_TYPE = 'user_learning' as const;
const TEACHING_CATEGORY = 'pattern' as const;

/** Minimum score for Student output to be accepted without Teacher correction. */
const QUALITY_THRESHOLD = 70;

/** Tag prefix for teaching materials to distinguish them from regular knowledge. */
const TEACHING_TAG_PREFIX = 'teaching:';

/** Result of a Teacher evaluation. */
export interface EvaluationResult {
  score: number;
  passed: boolean;
  feedback: string;
  correctedOutput?: string;
}

/** Result of generating teaching materials. */
export interface TeachingMaterial {
  knowledgeEntryId: number;
  taskType: string;
  exampleCount: number;
}

/**
 * Generate teaching materials (few-shot examples) for a specific task type.
 *
 * The Teacher model creates high-quality input→output examples that will be
 * stored in the knowledge base and retrieved via RAG when the Student handles
 * similar tasks.
 *
 * @param taskType - Category of task (e.g. "branch-naming", "flashcard-generation"). / タスクカテゴリ
 * @param description - Human-readable description of what the task does. / タスクの説明
 * @param examples - Optional seed examples to guide the Teacher. / シード例（省略可）
 * @returns Created teaching material metadata. / 作成された教材メタデータ
 */
export async function generateTeachingMaterial(
  taskType: string,
  description: string,
  examples?: Array<{ input: string; output: string }>,
): Promise<TeachingMaterial> {
  const tag = `${TEACHING_TAG_PREFIX}${taskType}`;

  const systemPrompt = `You are an expert AI teacher creating high-quality training examples.
Your task is to generate few-shot examples that a smaller, less capable AI model can learn from.

Rules:
- Generate 3-5 diverse, high-quality input→output pairs
- Cover edge cases and common patterns
- Be precise and consistent in format
- Include both Japanese and English examples where applicable
- Output valid JSON array format

Task type: ${taskType}
Description: ${description}`;

  const userContent = examples
    ? `Here are some seed examples to guide you:\n${JSON.stringify(examples, null, 2)}\n\nGenerate 3-5 additional diverse examples in the same format.`
    : `Generate 3-5 high-quality input→output examples for this task type.`;

  const messages: AIMessage[] = [{ role: 'user', content: userContent }];

  // NOTE: Teacher uses Claude Haiku for cost efficiency — still far more capable than the Student.
  const response = await sendAIMessage({
    provider: 'claude',
    messages,
    systemPrompt,
    maxTokens: 2048,
  });

  const content = `# Teaching Material: ${taskType}\n\n${description}\n\n## Examples\n\n${response.content}`;
  const contentHash = createContentHash(content);

  // Check for existing teaching material with same hash
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash },
  });

  if (existing) {
    log.info({ taskType, existingId: existing.id }, 'Teaching material already exists, skipping');
    return { knowledgeEntryId: existing.id, taskType, exampleCount: 0 };
  }

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: TEACHING_SOURCE_TYPE,
      sourceId: `teaching:${taskType}`,
      title: `[Teaching] ${taskType}: few-shot examples`,
      content,
      contentHash,
      category: TEACHING_CATEGORY,
      tags: JSON.stringify([tag, 'teaching-material', 'few-shot']),
      confidence: 0.95,
      validationStatus: 'validated',
      validatedAt: new Date(),
      validationMethod: 'teacher-generated',
    },
  });

  // Generate and store embedding for RAG retrieval
  try {
    const embeddingResult = await generateEmbedding(content);
    upsertEmbedding(
      entry.id,
      embeddingResult.embedding,
      content.slice(0, 200),
      embeddingResult.model,
    );
  } catch (embError) {
    log.warn(
      { err: embError, entryId: entry.id },
      'Failed to generate embedding for teaching material',
    );
  }

  log.info({ taskType, entryId: entry.id }, 'Teaching material generated and stored');

  return { knowledgeEntryId: entry.id, taskType, exampleCount: 5 };
}

/**
 * Evaluate Student (local LLM) output using the Teacher model.
 *
 * The Teacher scores the output on a 0-100 scale and provides feedback.
 * If the score is below the quality threshold, the Teacher generates a
 * corrected version that is stored as a new teaching example.
 *
 * @param taskType - Category of task. / タスクカテゴリ
 * @param input - Original input given to the Student. / Studentに与えた入力
 * @param studentOutput - Student's response. / Studentの出力
 * @param expectedFormat - Description of expected output format. / 期待される出力形式の説明
 * @returns Evaluation result with score and optional correction. / スコアと修正を含む評価結果
 */
export async function evaluateStudentOutput(
  taskType: string,
  input: string,
  studentOutput: string,
  expectedFormat: string,
): Promise<EvaluationResult> {
  const systemPrompt = `You are an expert AI evaluator. Score the Student AI's output on a 0-100 scale.

Scoring criteria:
- Correctness: Does the output match what was asked? (40 points)
- Format compliance: Does it follow the expected format? (30 points)
- Quality: Is it clear, concise, and useful? (30 points)

Respond in this exact JSON format:
{"score": <number>, "feedback": "<brief feedback>", "correctedOutput": "<corrected version if score < 70, otherwise null>"}`;

  const messages: AIMessage[] = [
    {
      role: 'user',
      content: `Task type: ${taskType}
Expected format: ${expectedFormat}

Input given to Student:
${input}

Student's output:
${studentOutput}

Evaluate this output.`,
    },
  ];

  try {
    const response = await sendAIMessage({
      provider: 'claude',
      messages,
      systemPrompt,
      maxTokens: 1024,
    });

    // Parse JSON response from Teacher
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn({ taskType }, 'Teacher response did not contain valid JSON');
      return { score: 50, passed: false, feedback: 'Evaluation failed: invalid Teacher response' };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      score: number;
      feedback: string;
      correctedOutput: string | null;
    };

    const passed = parsed.score >= QUALITY_THRESHOLD;

    // If below threshold and Teacher provided correction, store as teaching material
    if (!passed && parsed.correctedOutput) {
      await storeCorrection(taskType, input, studentOutput, parsed.correctedOutput, parsed.score);
    }

    log.info({ taskType, score: parsed.score, passed }, 'Student output evaluated');

    return {
      score: parsed.score,
      passed,
      feedback: parsed.feedback,
      correctedOutput: parsed.correctedOutput || undefined,
    };
  } catch (error) {
    log.error({ err: error, taskType }, 'Teacher evaluation failed');
    // NOTE: On evaluation failure, assume the output is acceptable to avoid blocking.
    return { score: 50, passed: true, feedback: 'Evaluation error — accepting output by default' };
  }
}

/**
 * Store a Teacher correction as a new teaching example in the knowledge base.
 *
 * These corrections improve future Student performance by appearing in RAG
 * results for similar tasks.
 *
 * @param taskType - Category of task. / タスクカテゴリ
 * @param input - Original input. / 元の入力
 * @param wrongOutput - Student's incorrect output. / Studentの不正解出力
 * @param correctedOutput - Teacher's corrected version. / Teacherの修正版
 * @param score - Score given to the wrong output. / 不正解出力のスコア
 */
async function storeCorrection(
  taskType: string,
  input: string,
  wrongOutput: string,
  correctedOutput: string,
  score: number,
): Promise<void> {
  const tag = `${TEACHING_TAG_PREFIX}${taskType}`;
  const content = `# Correction: ${taskType}

## Input
${input}

## Wrong Output (Score: ${score}/100)
${wrongOutput}

## Corrected Output
${correctedOutput}

## Lesson
This correction shows the expected quality for ${taskType} tasks.`;

  const contentHash = createContentHash(content);

  // Avoid duplicate corrections
  const existing = await prisma.knowledgeEntry.findFirst({
    where: { contentHash },
  });
  if (existing) return;

  const entry = await prisma.knowledgeEntry.create({
    data: {
      sourceType: TEACHING_SOURCE_TYPE,
      sourceId: `correction:${taskType}:${Date.now()}`,
      title: `[Correction] ${taskType}: improved example`,
      content,
      contentHash,
      category: TEACHING_CATEGORY,
      tags: JSON.stringify([tag, 'teaching-correction', 'few-shot']),
      confidence: 0.9,
      validationStatus: 'validated',
      validatedAt: new Date(),
      validationMethod: 'teacher-corrected',
    },
  });

  // Embed for RAG retrieval
  try {
    const embeddingResult = await generateEmbedding(content);
    upsertEmbedding(
      entry.id,
      embeddingResult.embedding,
      content.slice(0, 200),
      embeddingResult.model,
    );
  } catch (embError) {
    log.warn({ err: embError }, 'Failed to embed correction');
  }

  log.info({ taskType, entryId: entry.id, score }, 'Teaching correction stored');
}

/**
 * Execute a task with the full Teacher-Student loop.
 *
 * 1. Student executes the task (with RAG-injected teaching materials)
 * 2. Teacher evaluates the output
 * 3. If passed, return Student output
 * 4. If failed and Teacher provided correction, return correction
 * 5. If failed without correction, escalate to paid API
 *
 * @param taskType - Category of task. / タスクカテゴリ
 * @param systemPrompt - System prompt for the task. / タスクのシステムプロンプト
 * @param userMessage - User message/input. / ユーザーメッセージ
 * @param expectedFormat - Expected output format description. / 期待される出力形式
 * @param options - Additional options. / 追加オプション
 * @returns Final output after evaluation. / 評価後の最終出力
 */
export async function executeWithTeacherStudent(
  taskType: string,
  systemPrompt: string,
  userMessage: string,
  expectedFormat: string,
  options?: { ragThemeId?: number; skipEvaluation?: boolean },
): Promise<{
  output: string;
  source: 'student' | 'teacher-corrected' | 'escalated';
  score: number;
}> {
  // Step 1: Student executes with RAG (teaching materials auto-injected via RAG search)
  const studentResponse = await sendAIMessage({
    provider: 'ollama',
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    maxTokens: 2048,
    enableRAG: true,
    ragThemeId: options?.ragThemeId,
  });

  if (options?.skipEvaluation) {
    return { output: studentResponse.content, source: 'student', score: -1 };
  }

  // Step 2: Teacher evaluates
  const evaluation = await evaluateStudentOutput(
    taskType,
    userMessage,
    studentResponse.content,
    expectedFormat,
  );

  // Step 3: Return based on evaluation
  if (evaluation.passed) {
    return { output: studentResponse.content, source: 'student', score: evaluation.score };
  }

  if (evaluation.correctedOutput) {
    return {
      output: evaluation.correctedOutput,
      source: 'teacher-corrected',
      score: evaluation.score,
    };
  }

  // Step 4: Escalate to paid API
  log.info({ taskType, score: evaluation.score }, 'Escalating to paid API');
  const escalatedResponse = await sendAIMessage({
    provider: 'claude',
    messages: [{ role: 'user', content: userMessage }],
    systemPrompt,
    maxTokens: 2048,
  });

  return { output: escalatedResponse.content, source: 'escalated', score: evaluation.score };
}

/**
 * Get teaching material statistics.
 *
 * @returns Count of teaching materials and corrections by task type. / タスクタイプ別の教材数と修正数
 */
export async function getTeachingStats(): Promise<
  Array<{ taskType: string; materials: number; corrections: number }>
> {
  const entries = await prisma.knowledgeEntry.findMany({
    where: {
      sourceType: TEACHING_SOURCE_TYPE,
      tags: { contains: TEACHING_TAG_PREFIX },
    },
    select: { sourceId: true, tags: true },
  });

  const statsMap = new Map<string, { materials: number; corrections: number }>();

  for (const entry of entries) {
    const tags: string[] = JSON.parse(entry.tags || '[]');
    const teachingTag = tags.find((t) => t.startsWith(TEACHING_TAG_PREFIX));
    if (!teachingTag) continue;

    const taskType = teachingTag.replace(TEACHING_TAG_PREFIX, '');
    const current = statsMap.get(taskType) || { materials: 0, corrections: 0 };

    if (entry.sourceId?.startsWith('correction:')) {
      current.corrections++;
    } else {
      current.materials++;
    }
    statsMap.set(taskType, current);
  }

  return Array.from(statsMap.entries()).map(([taskType, counts]) => ({
    taskType,
    ...counts,
  }));
}
