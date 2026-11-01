/**
 * id-param-migration-baseline
 *
 * The route files that still coerce a path parameter to a number without
 * validating it, in a mutating handler. `require-validated-id-param` is an
 * error everywhere EXCEPT these files, so new code and every migrated file are
 * held to it while the backlog is worked through.
 *
 * This is a ratchet, like .baselines/file-size.json: the list may shrink and
 * never grow. id-param-migration-baseline.test.mjs enforces both directions —
 * an entry that no longer violates the rule fails the test, so a fixed file
 * cannot be left behind, and a file that is not listed is simply caught by the
 * rule itself.
 *
 * Why a baseline instead of fixing all 106 sites at once: #1349's first PR
 * covered routes/tasks/tasks.ts, this one covers the execution, task and
 * workflow mutation routes (17 sites). 89 sites across 37 files in one more PR
 * would not be reviewable, and each file needs its existing 400 shape kept —
 * resources.ts carries a Japanese message, the workflow release routes write
 * their own body. GET routes are a later stage and are not in scope of the rule
 * yet (see the rule's `methods` option).
 *
 * To remove an entry: guard the id with isValidEntityId (utils/common/
 * id-validation.ts) or use parseId (middleware/error-handler.ts), then delete
 * the line. Do NOT add an entry — a new violation means the code needs the
 * guard, not the exemption.
 */

/** Files exempt from require-validated-id-param, with their remaining count. */
export const ID_PARAM_MIGRATION_BASELINE = [
  'routes/agents/agent-version/version-write-routes.ts', // 3
  'routes/agents/preview/preview-routes.ts', // 5
  'routes/agents/system/resource-gate-router.ts', // 1
  'routes/ai/copilot-chat.ts', // 1
  'routes/ai/prompts.ts', // 4
  'routes/analytics/weekly-review.ts', // 1
  'routes/backlog/theme-override-routes.ts', // 1
  'routes/memory/concern-backlog.ts', // 3
  'routes/memory/hypothesis.ts', // 3
  'routes/memory/idea-box.ts', // 4
  'routes/memory/knowledge.ts', // 3
  'routes/memory/memory-system.ts', // 1
  'routes/memory/notes.routes.ts', // 1
  'routes/organization/categories.ts', // 3
  'routes/organization/labels.ts', // 3
  'routes/organization/milestones.ts', // 2
  'routes/organization/projects.ts', // 2
  'routes/organization/templates.ts', // 3
  'routes/organization/themes.ts', // 3
  'routes/scheduling/daily-schedule.ts', // 2
  'routes/scheduling/pomodoro.ts', // 4
  'routes/scheduling/schedules.ts', // 5
  'routes/scheduling/time-entries.ts', // 1
  'routes/self-improvement/miss-signatures.routes.ts', // 1
  'routes/self-learning/experiments.ts', // 4
  'routes/self-learning/learning.ts', // 2
  'routes/social/comments.ts', // 6
  'routes/social/github/integrations.ts', // 3
  'routes/system/auth/session-routes.ts', // 1
  'routes/system/calendar-shares/calendar-shares.routes.ts', // 1
  'routes/system/calendar-slots/calendar-slots.routes.ts', // 1
  'routes/system/developer-mode/analyze-route.ts', // 1
  'routes/system/developer-mode/config-routes.ts', // 3
  'routes/system/developer-mode/prompt-routes.ts', // 2
  'routes/system/directories.ts', // 2
  'routes/system/notifications.ts', // 2
  'routes/system/transcribe.ts', // 1
];
