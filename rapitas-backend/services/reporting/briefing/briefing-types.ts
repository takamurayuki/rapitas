/**
 * briefing-types
 *
 * Shared types of the night-run audio briefing (task #1258). Pure data
 * shapes only — no DB, no filesystem.
 */

/** A task that finished inside the report window. */
export interface BriefingCompletedItem {
  id: number;
  title: string;
  prNumber: number | null;
}

/** A blocked / paused task together with why it is held. */
export interface BriefingHeldItem {
  id: number;
  title: string;
  reason: string;
}

/** A held task that may need a human decision; options are structured data. */
export interface DecisionCandidate {
  id: number;
  title: string;
  priority: string;
  /** ISO date (YYYY-MM-DD or full ISO); null = no deadline. */
  dueDate: string | null;
  /** Number of other tasks waiting on this one. */
  blockingCount: number;
  reason: string;
  options: string[];
}

/** Structured input of one briefing, pre-fetched by the collect layer. */
export interface BriefingInput {
  /** Local YYYY-MM-DD report day. */
  date: string;
  completed: BriefingCompletedItem[];
  held: BriefingHeldItem[];
  decisionCandidates: DecisionCandidate[];
  /** Relative link to the full text. */
  linkUrl: string;
}

/** Fixed section ids, in playback order. */
export type BriefingSectionId = 'summary' | 'completed' | 'held' | 'decision' | 'link';

/** One spoken section. */
export interface BriefingSection {
  id: BriefingSectionId;
  lines: string[];
}

/** The generated script: ordered sections plus the single picked decision. */
export interface BriefingScript {
  date: string;
  sections: BriefingSection[];
  decision: DecisionCandidate | null;
  counts: { completed: number; held: number; decision: number };
}
