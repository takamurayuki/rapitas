/**
 * RoadmapTypes
 *
 * The shapes the roadmap conversation passes around: what the draft call
 * answers with, what the user picked, what came back from creating, and how
 * a failure is described.
 *
 * Lifted out of the hook when it outgrew the size limit, and kept together
 * because the component and the hook both read them — a shape that lives
 * inside one of them is a shape the other has to import from a file about
 * something else.
 */

export interface Placement {
  kind: 'existing' | 'new' | 'none';
  id?: number;
  name?: string;
  reason?: string;
}

export interface Question {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

export interface Step {
  title: string;
  description: string;
  dueDate?: string;
  /** Index into `Draft.milestones` of the milestone (節目) this step builds towards. */
  milestoneIndex?: number;
}

/** A stage between the goal and its steps, with what must be true to reach it. */
export interface Milestone {
  name: string;
  acceptanceCriteria: string[];
  dueDate?: string;
}

export interface Draft {
  goal: string;
  themeChoice: Placement;
  projectChoice: Placement;
  questions: Question[];
  steps: Step[];
  /** Present when the work is filed under a project; created there as its milestones. */
  milestones?: Milestone[];
  deadline?: string;
  /** What the plan takes for granted — note material, not task material. */
  assumptions?: string[];
  /** What to weigh candidates on, when the goal is a choice. */
  comparisonAxes?: string[];
}

/** One question and what the user picked, as the draft call wants it. */
export interface Decision {
  question: string;
  answer: string;
}

/**
 * Which step broke, and what came back.
 *
 * A single boolean was all this had, and the screen said only "it did not
 * work". When that happened for real the server had answered both draft
 * calls successfully, so neither the user nor the log could say which step
 * failed or why — the reason existed solely in the browser console.
 */
export interface RoadmapFailure {
  stage: 'drafting' | 'creating';
  /** The HTTP status, or the error's name — enough to tell causes apart. */
  detail: string;
}

/** Something the search found, and the page it came from. */
export interface Candidate {
  name: string;
  sourceUrl: string;
  /** Axis name to what the search established. Missing means not found. */
  values: Record<string, string>;
  why: string;
}

/** What one search came back with. */
export interface Findings {
  query: string;
  candidates: Candidate[];
  /** Axes nothing could be found for, named rather than left blank. */
  unresolvedAxes: string[];
}

export interface Committed {
  themeId: number | null;
  projectId: number | null;
  taskIds: number[];
  /** Milestones created under the project, in plan order. */
  milestoneIds?: number[];
  failedAfter: number | null;
}
