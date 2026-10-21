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
}

export interface Draft {
  goal: string;
  themeChoice: Placement;
  projectChoice: Placement;
  questions: Question[];
  steps: Step[];
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

export interface Committed {
  themeId: number | null;
  projectId: number | null;
  taskIds: number[];
  failedAfter: number | null;
}
