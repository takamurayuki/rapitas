/**
 * measure-risk-floor
 *
 * Measures how often the PLAN path of detectHighRisk raises the premium risk
 * floor over a theme's most recent plans, before (`planScope: 'full'`, the
 * legacy full-text probe) and after (declared-files mode, task 661) — so a
 * change to the detector is reported as a measured fire-rate delta, not a
 * guess. Read-only; prints a Markdown report to stdout.
 *
 * Run: `cd rapitas-backend && bun run scripts/measure-risk-floor.ts [--theme 1] [--limit 120]`
 * Data source: Prisma (DATABASE_URL). When that server is unreachable — the
 * desktop dev server runs on SQLite while .env points at PostgreSQL — the
 * script falls back to a read-only `bun:sqlite` open of `DB_PATH` (default:
 * the dev.js desktop DB), same as inspect-self-observation.ts.
 */
import { Database } from 'bun:sqlite';
import { detectHighRisk } from '../services/workflow/routing-policy';
import { extractPlanDeclaredFiles } from '../services/workflow/plan-declared-files';

const DEFAULT_SQLITE_PATH = 'C:/Projects/rapitas/rapitas-desktop/.data/rapitas-dev.db';

interface PlanRow {
  taskId: number;
  content: string;
  title: string;
  description: string | null;
  labels: string | null;
}

interface Verdict {
  taskId: number;
  textHigh: boolean;
  planOld: boolean;
  planNew: boolean;
  declaredCount: number;
}

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? Number(process.argv[i + 1]) : Number.NaN;
  return Number.isFinite(v) ? v : fallback;
}

function pct(n: number, total: number): string {
  return total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;
}

/** Same text composition as role-route-inputs.ts so the text path matches production. */
function taskText(row: PlanRow): string {
  const labelsText = typeof row.labels === 'string' ? row.labels : '';
  return `${row.title} ${row.description ?? ''} ${labelsText}`;
}

function judge(row: PlanRow): Verdict {
  const text = taskText(row);
  const textHigh = detectHighRisk({ text }).high;
  const oldHigh = detectHighRisk({ text, planContent: row.content, planScope: 'full' }).high;
  const newHigh = detectHighRisk({ text, planContent: row.content }).high;
  return {
    taskId: row.taskId,
    textHigh,
    // Plan-path fires are those NOT already explained by the task text.
    planOld: oldHigh && !textHigh,
    planNew: newHigh && !textHigh,
    declaredCount: extractPlanDeclaredFiles(row.content).length,
  };
}

async function loadViaPrisma(themeId: number, limit: number): Promise<PlanRow[]> {
  const { prisma } = await import('../config/database');
  try {
    const rows = await prisma.workflowFile.findMany({
      where: { fileType: 'plan', task: { themeId } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        taskId: true,
        content: true,
        task: { select: { title: true, description: true, labels: true } },
      },
    });
    return rows.map((r) => ({ taskId: r.taskId, content: r.content, ...r.task }));
  } finally {
    await prisma.$disconnect();
  }
}

function loadViaSqlite(themeId: number, limit: number): PlanRow[] {
  const dbPath = process.env.DB_PATH || DEFAULT_SQLITE_PATH;
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query(
        'SELECT wf.taskId AS taskId, wf.content AS content, t.title AS title, ' +
          't.description AS description, t.labels AS labels ' +
          'FROM WorkflowFile wf JOIN Task t ON t.id = wf.taskId ' +
          "WHERE wf.fileType = 'plan' AND t.themeId = ? ORDER BY wf.updatedAt DESC LIMIT ?",
      )
      .all(themeId, limit) as PlanRow[];
  } finally {
    db.close();
  }
}

async function loadPlans(themeId: number, limit: number): Promise<[PlanRow[], string]> {
  try {
    return [await loadViaPrisma(themeId, limit), 'prisma'];
  } catch (e) {
    console.error(
      `Prisma unreachable (${e instanceof Error ? e.message.split('\n')[0] : e}); ` +
        'falling back to bun:sqlite',
    );
    return [loadViaSqlite(themeId, limit), 'sqlite'];
  }
}

async function main(): Promise<void> {
  const themeId = argNum('--theme', 1);
  const limit = argNum('--limit', 120);
  const [rows, source] = await loadPlans(themeId, limit);

  const verdicts = rows.map(judge);
  const n = verdicts.length;
  const textFires = verdicts.filter((v) => v.textHigh).length;
  const planOld = verdicts.filter((v) => v.planOld).length;
  const planNew = verdicts.filter((v) => v.planNew).length;
  const failBack = verdicts.filter((v) => v.declaredCount === 0).length;
  const oldOnly = verdicts.filter((v) => v.planOld && !v.planNew).map((v) => v.taskId);
  const newOnly = verdicts.filter((v) => v.planNew && !v.planOld).map((v) => v.taskId);
  const list = (ids: number[]): string => (ids.length ? ids.join(', ') : 'なし');

  console.log(
    `# risk floor 発火率計測（theme ${themeId}、直近 ${n} plan、limit ${limit}、source ${source}）`,
  );
  console.log('');
  console.log('| 指標 | 件数 | 率 |');
  console.log('| --- | --- | --- |');
  console.log(`| 母集団 N | ${n} | 100% |`);
  console.log(`| text 経路発火 | ${textFires} | ${pct(textFires, n)} |`);
  console.log(`| plan 経路発火（旧: 全文評価） | ${planOld} | ${pct(planOld, n)} |`);
  console.log(`| plan 経路発火（新: 宣言節評価） | ${planNew} | ${pct(planNew, n)} |`);
  console.log(`| fail-back（宣言パス 0 件） | ${failBack} | ${pct(failBack, n)} |`);
  console.log('');
  console.log(`- 旧のみ発火（節外言及の解消候補）: ${list(oldOnly)}`);
  console.log(`- 新のみ発火（偽陰性の解消候補）: ${list(newOnly)}`);
}

main().catch((e: unknown) => {
  console.error('measure-risk-floor failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
