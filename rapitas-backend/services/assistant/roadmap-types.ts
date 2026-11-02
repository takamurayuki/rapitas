/**
 * RoadmapTypes
 *
 * The shape of a drafted plan, shared by the half that invents it, the half
 * that checks it and the route that carries it.
 *
 * Kept apart from both so the checking half can import the shapes without
 * importing the model client, and so a change to the shape shows up in one
 * place rather than three.
 */
import type { RoadmapAnswer } from './roadmap-prompts';

/** Where the work should go, once the invented ids are stripped out. */
export type Placement =
  | { kind: 'existing'; id: number; name: string }
  | { kind: 'new'; name: string; reason: string }
  | { kind: 'none'; reason: string };

export interface RoadmapStep {
  title: string;
  /**
   * What to do and what counts as done, ready to be read as a task's own
   * description. Composed here rather than on screen so what the user
   * approves is character-for-character what gets created.
   */
  description: string;
  /** When it should be finished, only when a deadline was named (YYYY-MM-DD). */
  dueDate?: string;
}

export interface RoadmapQuestion {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

export interface RoadmapDraft {
  /** The goal as she understood it, so a misreading shows before any work. */
  goal: string;
  themeChoice: Placement;
  projectChoice: Placement;
  questions: RoadmapQuestion[];
  steps: RoadmapStep[];
  /** The deadline the request implied, as a date (YYYY-MM-DD). */
  deadline?: string;
  /** What the plan takes for granted, for the note rather than the tasks. */
  assumptions: string[];
  /**
   * What to weigh the candidates on, when the goal is a choice.
   *
   * Axes only, never the candidates' own facts: she cannot look anything up
   * from here, so a filled-in comparison would be invented. The note gets a
   * table with these as columns for the user to fill.
   */
  comparisonAxes: string[];
}

/** What the second round needs that the first one did not. */
export interface RoadmapRound {
  /** What the user picked, which turns this into the final round. */
  answers?: RoadmapAnswer[];
  /** Overridable so a date assertion means the same thing every day. */
  today?: Date;
}
