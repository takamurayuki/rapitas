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
 * #1349 is being worked through by HTTP verb, because the dangerous ones are
 * not evenly dangerous and each file needs its own 400 shape kept:
 *
 *   PR 1  routes/tasks/tasks.ts                      7 sites
 *   PR 2  execution / task / workflow mutations      17 sites
 *   PR 3  every remaining DELETE                     24 sites
 *   PR 4  every remaining PATCH and PUT              24 sites
 *   ----  still listed below                         41 sites in 23 files
 *         (POST only; GET is not in the rule's scope yet — see its
 *          `methods` option — and holds ~50 more)
 *
 * What PRs 3 and 4 found: a guard being present means nothing. 36 of their 48
 * sites already had one and every single one let the truncated value through.
 * isNaN, Number.isFinite, Number.isSafeInteger and Number.isInteger all run
 * AFTER parseInt and so inspect what it already returned, not what was asked
 * for. `/labels/5e2` resolved to label 500, `PUT /tasks/5e2/labels` emptied
 * task 5's labels, and `/calendar-shares/5e2` revoked workspace 500's grant.
 *
 * To remove an entry: guard the id with isValidEntityId (utils/common/
 * id-validation.ts) or use parseId (middleware/error-handler.ts), then delete
 * the line. Do NOT add an entry — a new violation means the code needs the
 * guard, not the exemption.
 */

/** Files exempt from require-validated-id-param, with their remaining count. */
export const ID_PARAM_MIGRATION_BASELINE = [
  'routes/agents/agent-version/version-write-routes.ts', // 3
  'routes/agents/preview/preview-routes.ts', // 4
  'routes/agents/system/resource-gate-router.ts', // 1
  'routes/ai/copilot-chat.ts', // 1
  'routes/ai/prompts.ts', // 2
  'routes/memory/concern-backlog.ts', // 1
  'routes/memory/hypothesis.ts', // 1
  'routes/memory/idea-box.ts', // 2
  'routes/memory/knowledge.ts', // 1
  'routes/memory/memory-system.ts', // 1
  'routes/organization/templates.ts', // 2
  'routes/scheduling/pomodoro.ts', // 4
  'routes/scheduling/schedules.ts', // 3
  'routes/scheduling/time-entries.ts', // 1
  'routes/self-improvement/miss-signatures.routes.ts', // 1
  'routes/self-learning/experiments.ts', // 3
  'routes/self-learning/learning.ts', // 2
  'routes/social/comments.ts', // 2
  'routes/social/github/integrations.ts', // 1
  'routes/system/calendar-slots/calendar-slots.routes.ts', // 1
  'routes/system/developer-mode/analyze-route.ts', // 1
  'routes/system/developer-mode/config-routes.ts', // 1
  'routes/system/developer-mode/prompt-routes.ts', // 2
];
