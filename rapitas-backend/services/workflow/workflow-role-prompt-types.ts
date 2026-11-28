/**
 * Workflow Role Prompt Types
 *
 * Shapes of the per-role ja/en prompt texts built by workflow-role-prompts.ts.
 * Split out of that file to keep it under the 300-line threshold.
 */

/** Researcher-role prompt texts. */
export interface ResearcherTexts {
  /** Lead instruction to investigate the codebase. */
  instruction: string;
  /** Premise-audit directive (R2). */
  premiseAudit: string;
  /** Investigation item list. */
  items: string;
  /** Output-format instruction for research.md. */
  output: string;
}

/** Planner-role prompt texts. */
export interface PlannerTexts {
  /** Heading placed above the research.md content. */
  researchHeader: string;
  /** Lead instruction to produce plan.md. */
  instruction: string;
  /** Premortem directive (R7). */
  premortem: string;
  /** Self-containment rule for plan.md. */
  selfContainment: string;
}

/** Implementer-role prompt texts. */
export interface ImplementerTexts {
  /** Heading placed above the research.md content. */
  researchHeader: string;
  /** Heading placed above the plan.md content. */
  planHeader: string;
  /** Heading placed above the question.md content. */
  reviewHeader: string;
  /** Lead instruction when plan.md exists. */
  leadWithPlan: string;
  /** Lead instruction when plan.md does not exist (lightweight mode). */
  leadNoPlan: string;
  /** Implementer constraints block (self-verification API etc.). */
  constraints: string;
}

/** Verifier-role prompt texts (shared by auto_verifier). */
export interface VerifierTexts {
  /** Heading placed above the plan.md content. */
  planHeader: string;
  /** Heading placed above the git diff block. */
  diffHeader: string;
  /** Full verifier instruction block. */
  instruction: string;
}

/** All prompt texts for one language, keyed by role. */
export interface RoleContextTexts {
  /** Task metadata block (title / description / task id). */
  taskInfo: string;
  /** question.md machine-readable format guidance. */
  questionFormat: string;
  researcher: ResearcherTexts;
  planner: PlannerTexts;
  implementer: ImplementerTexts;
  verifier: VerifierTexts;
}
