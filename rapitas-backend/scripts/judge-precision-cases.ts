/**
 * judge-precision-cases
 *
 * Finds replayable cases for the judge precision probe: a task branch whose
 * task still exists, still has a plan and acceptance criteria, and still has
 * a diff against its merge base. Owns only case supply; scoring is in
 * judge-precision-scoring.ts and the run itself in judge-precision.ts.
 */
import { spawnSync } from 'child_process';
import { parseUnifiedDiff, type DiffFile } from './judge-precision-scoring';

const API = process.env.RAPITAS_API_URL ?? 'http://127.0.0.1:3001';

/** One replayable case: a task branch and the task that produced it. */
export interface ProbeCase {
  caseId: string;
  ref: string;
  taskId: number;
  title: string;
  plan: string;
  acceptanceCriteria: string[];
  files: DiffFile[];
}

/** Read JSON from the running backend; null on any failure. */
async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? (r.stdout ?? '') : '';
}

/**
 * Task branches still present in this repository, newest commit first.
 *
 * Refs, not the PR table: that table's rows are stale (its newest PR number
 * is hundreds behind the repository's) and many of its `linkedTaskId` values
 * name tasks that no longer exist, while a branch name carries the task id
 * directly and is verifiable against the live task API.
 *
 * @returns Ref name paired with its task id / ref名とタスクID
 */
function taskRefs(): Array<{ ref: string; taskId: number }> {
  const out: Array<{ ref: string; taskId: number }> = [];
  const seen = new Set<number>();
  for (const line of git(['for-each-ref', '--sort=-committerdate', '--format=%(refname)']).split(
    '\n',
  )) {
    const m = /\/[a-z]+\/t(\d+)-/.exec(line);
    if (!m) continue;
    const taskId = parseInt(m[1], 10);
    if (seen.has(taskId)) continue;
    seen.add(taskId);
    out.push({ ref: line.trim(), taskId });
  }
  return out;
}

/**
 * Collect task branches that still have a live task, a plan and a diff.
 *
 * @param want - How many cases are needed / 必要なケース数
 * @param baseRef - Branch the diffs are taken against / 差分の基準ブランチ
 * @returns The cases found, newest first / 見つかったケース
 */
export async function collectCases(want: number, baseRef: string): Promise<ProbeCase[]> {
  const cases: ProbeCase[] = [];
  for (const { ref, taskId } of taskRefs()) {
    if (cases.length >= want) break;
    const mergeBase = git(['merge-base', baseRef, ref]).trim();
    if (!mergeBase) continue;
    const files = parseUnifiedDiff(git(['diff', mergeBase, ref]));
    // Two files minimum, or the ablated arm would leave an empty diff.
    if (files.length < 2) continue;
    const task = await api<{
      task?: { title?: string; acceptanceCriteria?: string | null };
      title?: string;
      acceptanceCriteria?: string | null;
    }>(`/tasks/${taskId}`);
    const t = task?.task ?? task;
    const plan = await api<{ exists?: boolean; content?: string }>(
      `/workflow/tasks/${taskId}/files/plan`,
    );
    if (!t?.title || !plan?.exists || !plan.content) continue;
    let criteria: string[] = [];
    try {
      const parsed = JSON.parse(t.acceptanceCriteria ?? '[]');
      if (Array.isArray(parsed))
        criteria = parsed.filter((c): c is string => typeof c === 'string');
    } catch {
      criteria = [];
    }
    // A judge asked to score against nothing scores against its own taste,
    // which is not what the gate does in production.
    if (criteria.length === 0) continue;
    cases.push({
      caseId: `t${taskId}`,
      ref,
      taskId,
      title: t.title,
      plan: plan.content,
      acceptanceCriteria: criteria,
      files,
    });
  }
  return cases;
}
