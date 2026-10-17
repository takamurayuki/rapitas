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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createTask } from '../task/task-mutations';
import { parseRequirementTasks, outOfScopeItems } from '../organization/requirements-task-plan';
import { toTaskPayload } from '../organization/requirements-task-payload';
import { getDisabledThemeIds } from './theme-backlog-override-service';
import {
  readRequirementsFile,
  readDesignFile,
  hasProjectRootFile,
} from './requirements-document-reader';
import {
  needsEnvironmentBootstrap,
  RUNTIME_CONFIG_FILE,
  BOOTSTRAP_TASK_PREFIX,
} from '../organization/project-bootstrap-task';
import {
  fileBootstrapTask,
  fileDriftTask,
  fileScreenTasks,
  fileSpecGateTask,
  hasBootstrapTaskFiled,
  unfiledScreens,
} from './requirement-intake-filers';
import { parseScreenTasks } from '../organization/screen-task-plan';
import { checkSpecConsistency, specIsImplementable } from '../organization/spec-consistency';
import { reportIntakeOutcome, type IntakeOutcome } from './requirement-intake-outcome';
import type { IntakeTheme, RequirementIntakeDeps } from './requirement-intake-types';

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

/**
 * Root files whose presence means dependencies can be installed here.
 *
 * A project scaffolded as documents-only has none of these, which is the state
 * the environment-setup task exists to leave behind.
 */
const MANIFEST_FILES = [
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
] as const;

export type { IntakeTheme, RequirementIntakeDeps } from './requirement-intake-types';

function defaultDeps(): RequirementIntakeDeps {
  return {
    listThemes: async () => {
      const disabled = await getDisabledThemeIds('requirement_intake');
      return prisma.theme.findMany({
        where: {
          workingDirectory: { not: null },
          ...(disabled.size > 0 ? { id: { notIn: [...disabled] } } : {}),
        },
        select: {
          id: true,
          workingDirectory: true,
          defaultBranch: true,
          runtimeConfigJson: true,
        },
        take: MAX_THEMES,
      });
    },
    readRequirements: readRequirementsFile,
    readDesign: readDesignFile,
    // Checked on the real filesystem rather than through git: the question is
    // whether an install can run HERE, which only the working tree answers.
    hasProjectManifest: (dir) => MANIFEST_FILES.some((f) => existsSync(join(dir, f))),
    hasRuntimeConfigFile: (dir, branch) => hasProjectRootFile(dir, RUNTIME_CONFIG_FILE, branch),
    listExistingTitles: async (themeId) => {
      const rows = await prisma.task.findMany({ where: { themeId }, select: { title: true } });
      return rows.map((r) => r.title);
    },
    countUnstartedTasks: (themeId) =>
      prisma.task.count({ where: { themeId, status: { in: [...UNSTARTED_STATUSES] } } }),
    // An unfinished setup task means the theme is legitimately waiting; zero
    // unfinished ones mean the wait has no exit (see requirement-intake-outcome).
    isBootstrapTaskFinished: async (themeId) =>
      (await prisma.task.count({
        where: {
          themeId,
          title: { startsWith: BOOTSTRAP_TASK_PREFIX },
          status: { in: [...UNSTARTED_STATUSES] },
        },
      })) === 0,
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
      const outcome = await intakeTheme(theme, theme.workingDirectory, deps);
      total += outcome.filed;
      // A bare count cannot distinguish "nothing left to file" from "this theme
      // can never file again" — reporting that difference is the point (F1).
      await reportIntakeOutcome(outcome).catch(() => {});
    } catch (err) {
      log.warn({ err, themeId: theme.id }, 'Requirement intake failed for theme (non-fatal)');
    }
  }

  log.info({ total, themes: themes.length }, 'Requirement intake complete');
  return total;
}

async function intakeTheme(
  theme: IntakeTheme,
  workingDirectory: string,
  deps: RequirementIntakeDeps,
): Promise<IntakeOutcome> {
  const themeId = theme.id;
  const defaultBranch = theme.defaultBranch;
  const markdown = await deps.readRequirements(workingDirectory, defaultBranch);
  if (!markdown) return { themeId, kind: 'requirements_missing', filed: 0 };

  const specs = parseRequirementTasks(markdown);
  if (specs.length === 0) return { themeId, kind: 'no_features_declared', filed: 0 };
  const outOfScope = outOfScopeItems(markdown);
  const existing = await deps.listExistingTitles(themeId);
  const existingSet = new Set(existing);

  // A documents-only project gets its environment FIRST, and nothing else this
  // run. Filing features into a directory with no manifest makes every gate
  // report "unverified"; worse, runtime-smoke only runs for projects that
  // registered preview config, so without the setup task's
  // `rapitas.runtime.json` every feature after it would pass on static checks
  // alone — the shape that shipped TempoRaid's upload-panel-only app.
  // Preview config counts as part of being set up: the project now arrives with
  // a manifest, so without this the setup task — the only thing that registers
  // `rapitas.runtime.json` — would never be filed at all.
  const hasManifest = deps.hasProjectManifest(workingDirectory);
  if (
    needsEnvironmentBootstrap({
      hasRequirements: true,
      hasManifest,
      hasRuntimeConfig:
        Boolean(theme.runtimeConfigJson?.trim()) ||
        (await deps.hasRuntimeConfigFile(workingDirectory, defaultBranch)),
    })
  ) {
    const filed = await fileBootstrapTask(
      themeId,
      workingDirectory,
      defaultBranch,
      existing,
      deps,
      {
        hasManifest,
      },
    );
    if (filed > 0) return { themeId, kind: 'filed', filed };
    // Zero here means the setup task was already filed (or its creation
    // failed). Whether that is a wait or a dead end depends on the task's own
    // state, which only the caller's dep can answer.
    const setupDone = hasBootstrapTaskFiled(existing)
      ? await deps.isBootstrapTaskFinished?.(themeId)
      : undefined;
    return { themeId, kind: 'environment_pending', filed: 0, setupDone };
  }

  // The checker already decides whether a document can be implemented, but
  // until now only the wizard asked it — and the wizard stops after two review
  // rounds (review-prompt.ts shouldReviewAgain) whether or not `implementable`
  // ever became true, while docs/requirements.md stays an ordinary editable
  // file afterwards. Measured 2026-10-12 on TempoRaid: a requirements.md with
  // no `# 画面導線` section filed 12 features, all 12 completed and merged, and
  // one of the twelve was reachable from the shipped screen (audit #1244).
  // Holding the features back is the point — a warning would leave that shape
  // reachable, since the criteria those tasks passed never required a screen.
  const design = await deps.readDesign(workingDirectory, defaultBranch).catch(() => null);
  const findings = checkSpecConsistency({ requirements: markdown, design });
  if (!specIsImplementable(findings)) {
    const filed = await fileSpecGateTask(themeId, findings, existing, deps);
    return {
      themeId,
      kind: 'spec_incomplete',
      filed,
      blocking: findings.filter((f) => f.severity === 'error').length,
    };
  }

  // Throttle on the OUTSTANDING backlog, not just on this run's volume: the
  // auto-run slot is shared across themes, so filing faster than the theme is
  // worked starves every other project without raising an error anywhere.
  // Computed before the screen gate so both kinds of filing share one budget.
  const unstarted = await deps.countUnstartedTasks(themeId);
  const headroom = Math.max(0, MAX_UNSTARTED_PER_THEME - unstarted);
  const limit = Math.min(headroom, MAX_FILES_PER_THEME_RUN);

  // Screens before features. A feature whose 画面導線 names a screen that does
  // not exist has to build it as a side effect, and every feature's design
  // legitimately puts the UI outside its own scope — TempoRaid's design.md:159
  // lists 「webのログイン画面」 under F-11's 範囲外. Its 画面一覧 declared seven
  // screens, none became a task, and twelve finished features shipped two
  // .tsx files (audit #1244). A document with no 画面一覧 parses to zero
  // screens and takes the unchanged path.
  const screensToFile = unfiledScreens(parseScreenTasks(markdown), existing);
  if (screensToFile.length > 0) {
    const filed = await fileScreenTasks(themeId, screensToFile, outOfScope, limit, deps);
    return { themeId, kind: 'screens_pending', filed, pending: screensToFile.length };
  }

  // A reworded heading must not re-file the feature, so an existing title that
  // starts with the same `[F-NN]` label counts as filed.
  const pending = specs
    .map((spec) => ({ spec, payload: toTaskPayload(spec, { themeId, outOfScope }) }))
    .filter(({ spec, payload }) => {
      if (existingSet.has(payload.title)) return false;
      const label = `[${spec.id}]`;
      return !existing.some((t) => t.trimStart().startsWith(label));
    });

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
  if (filed > 0) return { themeId, kind: 'filed', filed };
  // Nothing filed: either every declared feature already has a task (normal),
  // or the cap is holding features back (a stop nobody was told about).
  if (pending.length > 0) {
    return {
      themeId,
      kind: 'throttled',
      filed: 0,
      pending: pending.length,
      unstarted,
      cap: MAX_UNSTARTED_PER_THEME,
    };
  }
  return { themeId, kind: 'all_filed', filed: 0 };
}
