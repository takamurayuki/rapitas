/**
 * Workflow Implementer Context
 *
 * Assembles the prompt context string for the implementer role (goal anchor,
 * memory, pitfalls, lessons, hypothesis ledger, CBR case, budgeted research /
 * verify feedback, plan, question, bug-fix protocol). Does not build contexts
 * for other roles.
 */
import { observeWorkflowStage } from './workflow-stage-timing';
import { readWorkflowFile } from './workflow-file-utils';
import { buildMemoryContext } from './workflow-memory-context';
import { buildKnownPitfallsSection } from './workflow-pitfall-context';
import { buildFileSizeAwarenessSection } from './workflow-file-size-context';
import { buildHypothesisContext } from './workflow-hypothesis-context';
import { buildCaseContext } from './workflow-case-context';
import { buildCriticLessonsSection } from './phase-critic';
import { recordContextMetrics } from './workflow-context-metrics';
import { buildRepairRiskTacticSection } from './learning/repair-risk-tactic-section';
import { budgetSection, resolveBudgetMode } from './workflow-context-budget';
import { buildGoalAnchor } from './workflow-goal-anchor';
import type { ImplementerTexts } from './workflow-role-prompts';

/**
 * Builds the TDD protocol instruction block appended to the implementer
 * prompt, or `''` for tasks with no testable behavior. Required for all
 * substantive tasks (R? — full-project TDD adoption), not just bug fixes —
 * see `requiresTestsForTask`'s doc comment (automated-verifier.ts) for the
 * scope decision this mirrors. The verification gate enforces "a test file
 * changed" (coverage) AND, when one did, that it genuinely fails without this
 * diff's source changes (red-state check) — so tell the implementer the exact
 * protocol up front instead of bouncing it later. Bug fixes get a
 * defect-framed variant (looksLikeBugFixTask); everything else gets the
 * feature/acceptance-framed variant, since "reproduce the defect" makes no
 * sense for new behavior. Pure given its inputs (the dynamic import is
 * side-effect-free), so it's unit-testable without the rest of
 * buildImplementerContext's DB-backed dependencies.
 *
 * @param taskText - Task title + description. / タスクのタイトルと説明
 * @param language - Output language. / 出力言語
 * @returns The instruction block (leading blank line included), or ''. / 指示ブロック（先頭に空行を含む）または空文字
 */
export async function buildTddProtocolSection(
  taskText: string,
  language: 'ja' | 'en',
): Promise<string> {
  // Dynamic import avoids a workflow↔agents/verification import cycle (same
  // reason the pre-TDD-adoption bug-fix-only check used one here).
  const { looksLikeBugFixTask, looksLikeTrivialTask } =
    await import('../agents/verification/automated-verifier');
  if (looksLikeTrivialTask(taskText)) return '';
  if (looksLikeBugFixTask(taskText)) {
    return language === 'ja'
      ? '\n\n## バグ修正の必須手順（検証ゲートで強制されます）\n' +
          '1. 修正の**前に**、不具合を再現する失敗テストを書き、現状コードで失敗することを確認する（RED）。\n' +
          '2. 修正を実装し、そのテストが通ることを確認する（GREEN — fail→pass が完了の根拠）。\n' +
          '3. 検証ゲートは (a) 再現テストの追加・更新があること、(b) そのテストが本差分のソース変更なしでは実際に失敗すること、の両方を確認します。後付けで書いた「差分が無くても通る」テストは差し戻されます。\n' +
          '4. UI操作のみで再現するなどテスト化が本当に不可能な場合のみ、その理由を最終サマリに明記してください。'
      : '\n\n## Bug-fix protocol (enforced by the verification gate)\n' +
          '1. BEFORE fixing, write a failing test that reproduces the defect and confirm it fails on the current code (RED).\n' +
          '2. Implement the fix and confirm that test now passes (GREEN — the fail→pass transition is the completion evidence).\n' +
          "3. The gate checks BOTH that a reproducing/regression test was added or changed, AND that it genuinely fails without this diff's source changes. A test written after the fact that would pass regardless is bounced.\n" +
          '4. Only when a test is genuinely impossible (e.g. UI-interaction-only repro) state the reason in your final summary.';
  }
  return language === 'ja'
    ? '\n\n## TDDの必須手順（検証ゲートで強制されます）\n' +
        '1. 実装の**前に**、受入基準を満たすことを確認するテストを書き、現状コードで失敗することを確認する（RED）。\n' +
        '2. そのテストが通る最小限の実装を行う（GREEN — fail→pass が完了の根拠）。\n' +
        '3. 検証ゲートは (a) テストの追加・更新があること、(b) そのテストが本差分のソース変更なしでは実際に失敗すること、の両方を確認します。実装後にまとめて書いた「差分が無くても通る」テストは差し戻されます。\n' +
        '4. ドキュメントのみ・設定値のみ・依存バージョンのみの変更など、テスト化できる振る舞いが無い場合のみ、その理由を最終サマリに明記してください。'
    : '\n\n## TDD protocol (enforced by the verification gate)\n' +
        '1. BEFORE implementing, write a test that encodes the acceptance criteria and confirm it fails on the current code (RED).\n' +
        '2. Implement the minimal change that makes it pass (GREEN — the fail→pass transition is the completion evidence).\n' +
        "3. The gate checks BOTH that a test was added or changed, AND that it genuinely fails without this diff's source changes. A test written after the fact that would pass regardless is bounced.\n" +
        '4. Only when there is no testable behavior (docs-only, config-only, dependency-only) state the reason in your final summary.';
}

/**
 * Build the implementer role's prompt context.
 *
 * @param taskId - Task id used to read prior artifacts and record metrics. / タスクID
 * @param task - Task title and description. / タスクのタイトルと説明
 * @param language - Output language. / 出力言語
 * @param mode - Resolved workflow mode. / 解決済みワークフローモード
 * @param taskInfo - Pre-built task-info block. / タスク情報ブロック
 * @param texts - Implementer prompt texts for the language. / implementer用テキスト
 * @param questionFormat - question.md format guidance block. / question.md フォーマット規約
 * @param styleRule - Report style rule block. / 文体ルールブロック
 * @returns Assembled implementer context string. / implementer用コンテキスト文字列
 */
export async function buildImplementerContext(
  taskId: number,
  task: { title: string; description: string | null },
  language: 'ja' | 'en',
  mode: 'lightweight' | 'standard' | 'comprehensive',
  taskInfo: string,
  texts: ImplementerTexts,
  questionFormat: string,
  styleRule: string,
): Promise<string> {
  const plan = await readWorkflowFile(taskId, 'plan');
  const question = await readWorkflowFile(taskId, 'question');
  const research = await readWorkflowFile(taskId, 'research');
  // On a self-repair bounce, verify/CI failure feedback is written to
  // verify.md (not question.md) — read it so the implementer fixes it.
  const verifyFeedback = await readWorkflowFile(taskId, 'verify');
  // Goal anchor (R7): re-state the task's GOAL + acceptance criteria at the
  // very head of the implementer context. Long contexts drift off-goal —
  // every model degrades past ~100k tokens (arXiv:2505.02709) — and the
  // implementer's context is the largest (research + plan + memory +
  // bounce feedback). A compact anchor the agent is told to return to
  // counters that (ReflAct-style goal-state re-alignment, arXiv:2505.15182).
  const goalAnchor = await buildGoalAnchor(taskId, task, language);
  let ctx = `${taskInfo}${goalAnchor ? `\n\n${goalAnchor}` : ''}`;
  // Recall prior knowledge for the implementer too — known pitfalls and past
  // design decisions should steer the actual code changes, not just research.
  const memory = await observeWorkflowStage(taskId, 'context.buildMemoryContext', () =>
    buildMemoryContext(taskId, task, language),
  );
  if (memory) {
    ctx += `\n\n${memory}`;
  }
  // Known pitfalls from the knowledge graph: gate rejections this task's
  // type/technologies have historically hit, with cause-specific advice.
  const pitfalls = await observeWorkflowStage(taskId, 'context.buildKnownPitfallsSection', () =>
    buildKnownPitfallsSection(task, language),
  );
  if (pitfalls) {
    ctx += `\n\n${pitfalls}`;
  }
  // Cross-task learning loop: recurring adversarial diff-review rejections
  // (scope drift, missing planned files, acceptance-criteria misreads)
  // injected BEFORE coding so known bounce causes are prevented in-phase.
  const implementLessons = await observeWorkflowStage(
    taskId,
    'context.buildCriticLessonsSection',
    () => buildCriticLessonsSection('implement', language),
  );
  if (implementLessons) {
    ctx += `\n\n${implementLessons}`;
  }
  // Repair-risk tactics — see the researcher context for rationale.
  const implementRepairRisk = await buildRepairRiskTacticSection(
    taskId,
    task,
    'implement',
    language,
  );
  if (implementRepairRisk) {
    ctx += `\n\n${implementRepairRisk}`;
  }
  // Hypothesis ledger: the implementer's concrete changes + test results are
  // prime evidence — surface open/proven hypotheses and how to record it.
  const hypothesis = await buildHypothesisContext(taskId, language);
  if (hypothesis) {
    ctx += `\n\n${hypothesis}`;
  }
  // CBR (R9): only when there is NO plan (lightweight) — with a plan the
  // planner already consumed the solved case, and re-injecting it here
  // would bloat the largest context and could conflict with the plan.
  const implementerCase = plan ? null : await buildCaseContext(taskId, task, language);
  if (implementerCase) {
    ctx += `\n\n${implementerCase}`;
  }
  // Budget (enforce mode only): with a plan, research.md is redundant in
  // full (plan restates the needed facts) — clamp it; never clamp gate inputs.
  // research is only clamped when a plan exists (see condition below); verifyFeedback
  // has no such condition and is ALWAYS budget-wrapped (see feedbackBody below) because
  // it is prior-round self-repair prose, not a gate input — repeatedly re-bouncing the
  // same feedback verbatim across retries is the exact bloat this budget targets.
  const budgetMode = resolveBudgetMode();
  const researchBody =
    plan && research ? budgetSection(budgetMode, 'implementer.research', research) : research;
  if (research) {
    ctx += `\n\n${texts.researchHeader}\n\n${researchBody}`;
  }
  // File-size awareness (task 600): current line counts of the plan's
  // over-limit files, measured BEFORE coding — CI-only discovery came too late.
  const fileSizeAwareness = plan ? buildFileSizeAwarenessSection(plan, language) : '';
  if (fileSizeAwareness) {
    ctx += `\n\n${fileSizeAwareness}`;
  }
  if (plan) {
    ctx += `\n\n${texts.planHeader}\n\n${plan}`;
  }
  if (question) {
    ctx += `\n\n${texts.reviewHeader}\n\n${question}`;
  }
  const feedbackBody = verifyFeedback
    ? budgetSection(budgetMode, 'implementer.verifyFeedback', verifyFeedback)
    : verifyFeedback;
  if (feedbackBody) {
    const header =
      language === 'ja'
        ? '# 検証 / CI からの差し戻し（前回の失敗 — 必ず対応すること）'
        : '# Verification / CI feedback (previous failure — must address)';
    ctx += `\n\n${header}\n\n${feedbackBody}`;
  }
  const implementerLead = plan ? texts.leadWithPlan : texts.leadNoPlan;
  ctx += `\n\n${implementerLead}\n\n${texts.constraints}\n\n${questionFormat}\n\n${styleRule}`;
  const tddSection = await buildTddProtocolSection(
    `${task.title}\n${task.description ?? ''}`,
    language,
  );
  if (tddSection) {
    ctx += tddSection;
  }
  // research / verifyFeedback are budget-eligible: record BOTH the pre-budget
  // (raw) and injected (budgeted) size so the slimming effect is measurable
  // and the oversized-section culprit stays identifiable even in `log` mode.
  // prettier-ignore
  void recordContextMetrics(taskId, 'implementer', mode, { taskInfo, goalAnchor, memory, pitfalls, lessons: implementLessons, repairRisk: implementRepairRisk, hypothesis, case: implementerCase, research: { raw: research, budgeted: researchBody }, fileSizeAwareness, plan, question, verifyFeedback: { raw: verifyFeedback, budgeted: feedbackBody }, styleRule });
  return ctx;
}
