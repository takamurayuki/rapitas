/**
 * Theme Usage Resolver
 *
 * Maps AgentSession ids to a theme through
 * AgentSession.configId → DeveloperModeConfig.taskId → Task.themeId, and applies
 * the aggregation-only classification rules to theme-less tasks. Read-only:
 * never rewrites Task.themeId.
 */

import { prisma } from '../../../../../config/database';
import {
  UNCLASSIFIED_THEME_ID,
  type ClassificationRule,
} from '../../../../../services/usage-budget/usage-budget-types';

/** `in` list size per query — keeps SQLite well under its bound-variable limit. */
export const RESOLVE_CHUNK_SIZE = 500;

/** Theme resolution of one session; resolved=false means the join chain broke. */
export interface SessionTheme {
  themeId: number;
  resolved: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Pick a theme for a task title by keyword rules (case-insensitive substring,
 * enabled rules only, lowest sortOrder first).
 *
 * @param title - Task title / タスクタイトル
 * @param rules - Classification rules / 分類ルール
 * @returns Matching themeId, or null / 一致したテーマID（なければ null）
 */
export function classifyByRules(
  title: string | null | undefined,
  rules: ClassificationRule[],
): number | null {
  if (!title) return null;
  const haystack = title.toLowerCase();
  const ordered = rules
    .filter((r) => r.enabled && r.keyword.trim().length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id ?? 0) - (b.id ?? 0));
  for (const r of ordered) {
    if (haystack.includes(r.keyword.trim().toLowerCase())) return r.themeId;
  }
  return null;
}

/**
 * Resolve the theme of each session id.
 *
 * @param sessionIds - AgentSession ids (duplicates allowed) / セッションID
 * @param rules - Classification rules for theme-less tasks / 分類ルール
 * @returns Map sessionId → theme (every requested id is present) / セッション→テーマ
 */
export async function resolveSessionThemes(
  sessionIds: number[],
  rules: ClassificationRule[],
): Promise<Map<number, SessionTheme>> {
  const result = new Map<number, SessionTheme>();
  const uniqueSessions = Array.from(new Set(sessionIds));
  if (uniqueSessions.length === 0) return result;

  const sessionToConfig = new Map<number, number>();
  for (const ids of chunk(uniqueSessions, RESOLVE_CHUNK_SIZE)) {
    const rows = await prisma.agentSession.findMany({
      where: { id: { in: ids } },
      select: { id: true, configId: true },
    });
    for (const r of rows) sessionToConfig.set(r.id, r.configId);
  }

  const configToTask = new Map<number, number>();
  const configIds = Array.from(new Set(sessionToConfig.values()));
  for (const ids of chunk(configIds, RESOLVE_CHUNK_SIZE)) {
    const rows = await prisma.developerModeConfig.findMany({
      where: { id: { in: ids } },
      select: { id: true, taskId: true },
    });
    for (const r of rows) configToTask.set(r.id, r.taskId);
  }

  const tasks = new Map<number, { themeId: number | null; title: string }>();
  const taskIds = Array.from(new Set(configToTask.values()));
  for (const ids of chunk(taskIds, RESOLVE_CHUNK_SIZE)) {
    const rows = await prisma.task.findMany({
      where: { id: { in: ids } },
      select: { id: true, themeId: true, title: true },
    });
    for (const r of rows) tasks.set(r.id, { themeId: r.themeId, title: r.title });
  }

  for (const sessionId of uniqueSessions) {
    const configId = sessionToConfig.get(sessionId);
    const taskId = configId === undefined ? undefined : configToTask.get(configId);
    const task = taskId === undefined ? undefined : tasks.get(taskId);
    if (!task) {
      result.set(sessionId, { themeId: UNCLASSIFIED_THEME_ID, resolved: false });
      continue;
    }
    const themeId = task.themeId ?? classifyByRules(task.title, rules) ?? UNCLASSIFIED_THEME_ID;
    result.set(sessionId, { themeId, resolved: true });
  }
  return result;
}
