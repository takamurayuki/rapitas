/**
 * Eval Case Collector
 *
 * Lists completed-and-merged Task rows as candidate cases for the private
 * evaluation set (docs/eval-private-set.md). Prints JSON candidates to stdout
 * for human curation — it does NOT write to eval/private-set/cases/ itself,
 * so a reviewer always sees the category guess before a case is committed.
 *
 * Usage: bun run scripts/eval-collect-cases.ts --dry-run [--limit=50]
 */
import { resolvePrismaClientCtor } from '../config/prisma-client-resolver';
import type { EvalCategory } from '../eval/private-set/case-schema';

/** One row returned by {@link fetchCandidateTasks}. */
export interface CandidateTaskRow {
  id: number;
  title: string;
  description: string | null;
  status: string;
}

const CATEGORY_KEYWORDS: Array<{ category: EvalCategory; pattern: RegExp }> = [
  { category: 'investigation-only', pattern: /調査|research|investigat/i },
  { category: 'failure-recovery', pattern: /差し戻し|再試行|repair|recover|retry|失敗/i },
  {
    category: 'multi-service',
    pattern: /frontend.*backend|backend.*frontend|desktop|全体|複数サービス/i,
  },
  { category: 'bug-fix', pattern: /bug|fix|不具合|バグ|修正/i },
  { category: 'feature', pattern: /feat|feature|機能|追加/i },
];

/**
 * Estimates an {@link EvalCategory} from a task's title + description using a
 * keyword pass. Falls back to 'feature' when nothing matches, since most
 * completed tasks in this codebase are additive.
 *
 * @param title - Task title / タスクタイトル
 * @param description - Task description, may be null / タスク説明（null可）
 * @returns Estimated category / 推定カテゴリ
 */
export function estimateCategory(title: string, description: string | null): EvalCategory {
  const haystack = `${title}\n${description ?? ''}`;
  for (const { category, pattern } of CATEGORY_KEYWORDS) {
    if (pattern.test(haystack)) return category;
  }
  return 'feature';
}

/**
 * Fetches completed tasks that have a merged GitHub PR linked to them.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param limit - Max rows to return / 取得上限件数
 * @returns Candidate task rows / 候補タスク行
 */
export interface CandidateTaskSource {
  task: {
    findMany(args: unknown): Promise<CandidateTaskRow[]>;
  };
}

export async function fetchCandidateTasks(
  prisma: CandidateTaskSource,
  limit: number,
): Promise<CandidateTaskRow[]> {
  return prisma.task.findMany({
    where: {
      status: 'done',
      githubPrId: { not: null },
    },
    select: { id: true, title: true, description: true, status: true },
    take: limit,
    orderBy: { completedAt: 'desc' },
  });
}

/**
 * Builds candidate case JSON objects (not yet validated as full EvalCase —
 * `acceptanceCheck` is left for a human to fill in, since it can't be
 * inferred from the task row alone).
 *
 * @param rows - Candidate task rows / 候補タスク行
 * @returns Candidate objects ready for human curation / レビュー用の候補オブジェクト
 */
export function buildCandidates(rows: CandidateTaskRow[]): Array<{
  id: string;
  category: EvalCategory;
  taskDescription: string;
  initialFiles: string[];
  acceptanceCheck: string;
  expectedOutcome: 'fail-to-pass';
}> {
  return rows.map((row) => ({
    id: `task-${row.id}`,
    category: estimateCategory(row.title, row.description),
    taskDescription: row.description ?? row.title,
    initialFiles: [],
    acceptanceCheck: '',
    expectedOutcome: 'fail-to-pass' as const,
  }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  const PrismaClient = resolvePrismaClientCtor();
  const prisma = new PrismaClient();
  try {
    const rows = await fetchCandidateTasks(prisma, limit);
    const candidates = buildCandidates(rows);
    const byCategory = candidates.reduce<Record<string, number>>((acc, c) => {
      acc[c.category] = (acc[c.category] ?? 0) + 1;
      return acc;
    }, {});

    console.log(`[eval-collect-cases] ${candidates.length} candidate(s) found`);
    console.log(`[eval-collect-cases] by category: ${JSON.stringify(byCategory)}`);
    if (dryRun) {
      console.log(JSON.stringify(candidates, null, 2));
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  await main();
}
