/**
 * Self-Development Theme Resolver
 *
 * Answers "which theme develops RAPITAS ITSELF?" for the self-observation
 * subsystems (incident watcher, process retrospective) whose findings are about
 * rapitas' own machinery.
 *
 * Those subsystems file concerns with only an originTaskId, so submitConcern
 * inherits the theme of the task that exhibited the symptom. When that task
 * belongs to another project the finding lands in the wrong repository: task
 * 585 (theme コンバーター) triggered a state-inconsistency concern about
 * Task/AgentSession/AgentExecution — rapitas tables — which was promoted to
 * task 587 under the converter theme, so an agent tried to fix rapitas inside
 * C:\Projects\ime-live-converter. It honestly reported "対象コードなし" and
 * burned its entire repair budget on an impossible task.
 *
 * Identifies the theme by matching its workingDirectory against the backend's
 * own git root, so nothing is hardcoded to a theme id.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const execAsync = promisify(exec);
const log = createLogger('self-development-theme');

/** Cached resolution — the mapping cannot change without a restart-worthy edit. */
let cached: { themeId: number | null } | null = null;

/**
 * Normalize a path for comparison across separators, trailing slashes and case
 * (Windows paths reach the DB in both `C:\x` and `C:/x` forms).
 *
 * @param p - Path to normalize. / 正規化するパス
 * @returns Comparable form. / 比較用の形
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Resolve the theme whose working directory is rapitas' own checkout.
 *
 * @returns The self-development theme id, or null when no theme matches. / 自己開発テーマID
 */
export async function resolveSelfDevelopmentThemeId(): Promise<number | null> {
  if (cached) return cached.themeId;
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    const root = stdout.trim();
    if (!root) {
      cached = { themeId: null };
      return null;
    }
    const themes = await prisma.theme.findMany({
      where: { workingDirectory: { not: null } },
      select: { id: true, workingDirectory: true },
    });
    const match = themes.find(
      (t) => t.workingDirectory && normalizePath(t.workingDirectory) === normalizePath(root),
    );
    cached = { themeId: match?.id ?? null };
    if (!match) {
      log.warn(
        { root },
        '[self-development-theme] No theme points at the backend git root — self-observation findings keep the origin task theme',
      );
    }
    return cached.themeId;
  } catch (err) {
    log.warn({ err }, '[self-development-theme] Resolution failed — falling back to origin theme');
    cached = { themeId: null };
    return null;
  }
}

/** Clear the cache (tests only). */
export function resetSelfDevelopmentThemeCache(): void {
  cached = null;
}
