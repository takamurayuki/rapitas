/**
 * roadmap-commit-request
 *
 * Sends the approved plan to POST /assistant/roadmap/commit — exactly what was
 * on screen, milestones (節目) included — and returns what was created.
 * Split out of use-roadmap so the hook stays under the file-size limit.
 */
import { API_BASE_URL } from '@/utils/api';
import type { Committed, Draft } from './roadmap.types';

/**
 * Create the plan the user approved.
 *
 * @param draft - The plan as shown / 表示した計画
 * @returns What the server created / 作成結果
 * @throws {Error} `HTTP <status>` when the server refuses / サーバーが拒否した場合
 */
export async function postRoadmapCommit(draft: Draft): Promise<Committed> {
  const res = await fetch(`${API_BASE_URL}/assistant/roadmap/commit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmed: true,
      goal: draft.goal,
      themeChoice: draft.themeChoice,
      projectChoice: draft.projectChoice,
      steps: draft.steps,
      // Only sent when shown: the server creates them under the project.
      ...(draft.milestones?.length ? { milestones: draft.milestones } : {}),
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as Committed;
}
