/**
 * Workflow Orchestrator — System Prompt Resolution
 *
 * Resolves the system prompt content for a workflow role key (DB first, then
 * compiled defaults). Moved verbatim from workflow-orchestrator.ts (file-size
 * ratchet, task 627); behavior is unchanged.
 */
import { prisma } from '../../config';
import { DEFAULT_SYSTEM_PROMPTS } from '../../routes/ai/system-prompts/default-prompts';

/**
 * Resolves the system prompt content for a given key.
 *
 * @param key - The system prompt key to look up. / 検索するシステムプロンプトキー。
 * @returns The prompt content string. / プロンプト本文。
 *   B-2: DB hit → DB の content を返す。
 *   B-1: DB null + DEFAULT_SYSTEM_PROMPTS に key あり → default content を返す。
 *   B-1': DB null + DEFAULT_SYSTEM_PROMPTS にも key なし → `''` を返す。
 *
 * NOTE: DB record の content が `''` であってもフォールバックしない。
 * record の存在 = DB の意図として尊重するため、存在判定は `null` チェックのみ行う。
 */
export async function resolveSystemPromptContent(key: string): Promise<string> {
  const sp = await prisma.systemPrompt.findUnique({ where: { key } });
  if (sp !== null) return sp.content;
  const defaultEntry = DEFAULT_SYSTEM_PROMPTS.find((p) => p.key === key);
  return defaultEntry?.content ?? '';
}
