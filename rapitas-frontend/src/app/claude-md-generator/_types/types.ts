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
  /** 要件定義書（機能要件・画面・受け入れ基準）のマークダウン全文 / Requirements doc markdown */
  requirements?: string;
  /** 設計書（アーキテクチャ・データモデル・API設計）のマークダウン全文 / Design doc markdown */
  design?: string;
  /** エージェント行動規範（CLAUDE.md）のマークダウン全文 / Agent guide markdown */
  claude_md: string;
}

/** Identifies one generated document tab. / 生成ドキュメントのタブ識別子 */
export type DocKind = 'requirements' | 'design' | 'claude_md';
