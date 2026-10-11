/**
 * requirement-intake-job
 *
 * Periodic `requirement_intake` backlog job: reads each theme's
 * `docs/requirements.md`, files an implementation task for every `[F-NN]`
 * feature that is not yet a task, and files one follow-up task when the
 * document has fallen out of step with the work.
 * Not responsible for reading the document (requirements-document-reader.ts),
 * parsing it, payload shaping or drift rules — those live in
 * services/organization/requirements-task-{plan,payload}.ts and
 * services/organization/spec-drift.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createTask } from '../task/task-mutations';
import { parseRequirementTasks, outOfScopeItems } from '../organization/requirements-task-plan';
import {
  toTaskPayload,
  type RequirementTaskPayload,
} from '../organization/requirements-task-payload';
import {
  detectSpecDrift,
  toDriftTaskPayload,
  DRIFT_TASK_PREFIX,
  type DriftTaskPayload,
} from '../organization/spec-drift';
import { getDisabledThemeIds } from './theme-backlog-override-service';
import { readRequirementsFile } from './requirements-document-reader';

const log = createLogger('scheduling:requirement-intake');

/**
 * Per-theme cap per run. Each createTask runs a sequential complexity
 * analysis, so an unbounded burst would stall the poller; the remainder is
 * picked up next run because the title match makes filing idempotent.
 */
export const MAX_FILES_PER_THEME_RUN = 30;
/** Upper bound on themes scanned per run. */
const MAX_THEMES = 50;

/**
 * Outstanding un-started tasks a theme may hold before filing pauses.
 *
 * NOTE: The auto-run slot limit is ONE and it is shared across every theme, so
 * a project that files its whole feature list at once starves the others — with
 * no error anywhere, since `lastError` and `haltReason` both stay null and the
 * starved themes simply look idle. Measured 2026-10-11: TempoRaid's 12 filed
 * features occupied the only slot for about four hours, and rapitas's own
 * backlog had to be held off by hand for the duration. Capping the OUTSTANDING
 * count (not just the per-run count) keeps filing proportional to throughput,
 * and bounds the damage of a bad parse to a few tasks instead of a dozen.
 */
export const MAX_UNSTARTED_PER_THEME = 3;

/** Statuses that mean a filed task has not been worked yet. */
const UNSTARTED_STATUSES = ['todo', 'draft'] as const;

/** A theme eligible for scanning. */
export interface IntakeTheme {
  id: number;
  workingDirectory: string | null;
  /** Branch the project's documents are authoritative on. / 文書の正となるブランチ */
  defaultBranch?: string | null;
}

/** Side-effecting collaborators, injectable so tests need no module mocking. */
export interface RequirementIntakeDeps {
  listThemes: () => Promise<IntakeTheme[]>;
  /** Returns the document text, or null when absent / unreadable. */
  readRequirements: (
    workingDirectory: string,
    defaultBranch?: string | null,
  ) => Promise<string | null>;
  /** Titles of every task in the theme, regardless of status. */
  listExistingTitles: (themeId: number) => Promise<string[]>;
  /** How many filed tasks the theme has that nobody has started. */
  countUnstartedTasks: (themeId: number) => Promise<number>;
  /** Files one task; a falsy result means nothing was created. */
  createTask: (payload: RequirementTaskPayload | DriftTaskPayload) => Promise<unknown>;
}

function defaultDeps(): RequirementIntakeDeps {
  return {
    listThemes: async () => {
      const disabled = await getDisabledThemeIds('requirement_intake');
      return prisma.theme.findMany({
        where: {
          workingDirectory: { not: null },
          ...(disabled.size > 0 ? { id: { notIn: [...disabled] } } : {}),
        },
        select: { id: true, workingDirectory: true, defaultBranch: true },
        take: MAX_THEMES,
      });
    },
    readRequirements: readRequirementsFile,
    listExistingTitles: async (themeId) => {
      const rows = await prisma.task.findMany({ where: { themeId }, select: { title: true } });
      return rows.map((r) => r.title);
    },
    countUnstartedTasks: (themeId) =>
      prisma.task.count({ where: { themeId, status: { in: [...UNSTARTED_STATUSES] } } }),
    // NOTE: markAutoCreated is deliberately not called — flagging these as
    // backlog-created would make the auto-run exhaustion check ignore them.
    createTask: (payload) => createTask(prisma, { ...payload, status: 'todo' }),
  };
}

/**
 * File a task for every not-yet-filed `[F-NN]` feature across themes.
 *
 * @param deps - Collaborators (defaults to the real DB/filesystem) / 依存(既定は実環境)
 * @returns Number of tasks created / 起票したタスク数
 */
export async function runRequirementIntakeJob(
  deps: RequirementIntakeDeps = defaultDeps(),
): Promise<number> {
  const themes = await deps.listThemes();
  let total = 0;

  for (const theme of themes) {
    if (!theme.workingDirectory) continue;
    try {
      total += await intakeTheme(theme.id, theme.workingDirectory, theme.defaultBranch, deps);
    } catch (err) {
      log.warn({ err, themeId: theme.id }, 'Requirement intake failed for theme (non-fatal)');
    }
  }

  log.info({ total, themes: themes.length }, 'Requirement intake complete');
  return total;
}

async function intakeTheme(
  themeId: number,
  workingDirectory: string,
  defaultBranch: string | null | undefined,
  deps: RequirementIntakeDeps,
): Promise<number> {
  const markdown = await deps.readRequirements(workingDirectory, defaultBranch);
  if (!markdown) return 0;

  const specs = parseRequirementTasks(markdown);
  if (specs.length === 0) return 0;
  const outOfScope = outOfScopeItems(markdown);
  const existing = await deps.listExistingTitles(themeId);
  const existingSet = new Set(existing);

  // A reworded heading must not re-file the feature, so an existing title that
  // starts with the same `[F-NN]` label counts as filed.
  const pending = specs
    .map((spec) => ({ spec, payload: toTaskPayload(spec, { themeId, outOfScope }) }))
    .filter(({ spec, payload }) => {
      if (existingSet.has(payload.title)) return false;
      const label = `[${spec.id}]`;
      return !existing.some((t) => t.trimStart().startsWith(label));
    });

  // Throttle on the OUTSTANDING backlog, not just on this run's volume: the
  // auto-run slot is shared across themes, so filing faster than the theme is
  // worked starves every other project without raising an error anywhere.
  const unstarted = await deps.countUnstartedTasks(themeId);
  const headroom = Math.max(0, MAX_UNSTARTED_PER_THEME - unstarted);
  const limit = Math.min(headroom, MAX_FILES_PER_THEME_RUN);
  const batch = pending.slice(0, limit);
  if (pending.length > batch.length) {
    log.info(
      { themeId, deferred: pending.length - batch.length, unstarted, cap: MAX_UNSTARTED_PER_THEME },
      'Deferred to a later run to keep the shared auto-run slot fair',
    );
  }

  let filed = 0;
  for (const { spec, payload } of batch) {
    try {
      const task = await deps.createTask(payload);
      if (!task) continue;
      filed++;
      log.info({ themeId, featureId: spec.id }, 'Filed task from requirements.md');
    } catch (err) {
      log.warn({ err, themeId, featureId: spec.id }, 'Failed to file feature task (non-fatal)');
    }
  }

  filed += await fileDriftTask(themeId, markdown, existing, deps);
  return filed;
}

/**
 * File the documentation follow-up when the document and the work disagree.
 *
 * Runs after filing so this run's new tasks count as filed — otherwise every
 * run would report the features it had just created as missing from the work.
 *
 * @param themeId - Theme being scanned / 対象テーマ
 * @param markdown - requirements.md content / requirements.md の内容
 * @param existing - Task titles BEFORE this run's filing / 今回起票前のタスク名
 * @param deps - Injected collaborators / 注入された依存
 * @returns 1 when a task was filed, else 0 / 起票したら 1
 */
async function fileDriftTask(
  themeId: number,
  markdown: string,
  existing: readonly string[],
  deps: RequirementIntakeDeps,
): Promise<number> {
  // One open follow-up at a time: the job runs daily and the work is the same
  // every run until someone does it.
  if (existing.some((t) => t.trimStart().startsWith(DRIFT_TASK_PREFIX))) return 0;

  const findings = detectSpecDrift({ requirements: markdown, existingTitles: existing });
  const payload = toDriftTaskPayload(findings, { themeId });
  if (!payload) return 0;

  try {
    const task = await deps.createTask(payload);
    if (!task) return 0;
    log.info({ themeId, findings: findings.length }, 'Filed documentation drift task');
    return 1;
  } catch (err) {
    log.warn({ err, themeId }, 'Failed to file drift task (non-fatal)');
    return 0;
  }
}
