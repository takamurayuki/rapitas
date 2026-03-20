/**
 * types
 *
 * Shared TypeScript interfaces for the CLAUDE.md generator wizard.
 * Does not contain runtime logic — types only.
 */

export interface AppAnswers {
  genre: string;
  subs?: string[];
  elements?: string[];
  platform: string;
  scale: string;
  priority: string;
}

export interface AppProposal {
  id: number;
  name: string;
  tagline: string;
  concept: string;
  unique: string;
  difficulty: string;
  tech_hint: string[];
  title?: string;
  description?: string;
  score?: number;
}

export interface DynamicItem {
  id: string;
  icon: string;
  label: string;
}

export interface GenerateResult {
  tech_rationale: string;
  score: number;
  claude_md: string;
}
