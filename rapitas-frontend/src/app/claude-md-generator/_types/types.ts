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

/**
 * What the user actually knows about their own project.
 *
 * NOTE: Every field is free text and every field may be blank. Blank means "not
 * established", and the generator must record it as an assumption in the
 * requirements' 前提と未決事項 section rather than inventing a figure that then
 * decides the architecture. Measured 2026-10-11: TempoRaid's spec carried
 * 「同時接続は最大1万人」, p95 150ms and 99.5% availability — none of which was
 * ever asked, and all of which drove the choice of Redis room state plus a
 * horizontally scaled API.
 */
export interface ProjectContext {
  /** 想定ユーザー数（同時・月間など） */
  users?: string;
  /** レイテンシ・応答速度の要求 */
  latency?: string;
  /** 可用性・稼働率の要求 */
  availability?: string;
  /** 予算感（初期・運用） */
  budget?: string;
  /** 期限・リリース希望時期 */
  deadline?: string;
  /** 開発体制（人数・スキル） */
  team?: string;
  /** 既にある資産（データ・API・デザイン・アカウント） */
  assets?: string;
  /** 何が達成できたら成功か */
  success?: string;
  /** 業務ルール・法令・権利関係の制約 */
  domainRules?: string;
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

/** One generated skeleton file; paths are validated server-side. / 雛形の1ファイル */
export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface GenerateResult {
  tech_rationale: string;
  score: number;
  /** 要件定義書（機能要件・画面・受け入れ基準）のマークダウン全文 / Requirements doc markdown */
  requirements?: string;
  /** 設計書（アーキテクチャ・データモデル・API設計）のマークダウン全文 / Design doc markdown */
  design?: string;
  /** 技術選定記録（決定・代替案・却下理由）のマークダウン全文 / ADR markdown */
  adr?: string;
  /** プロジェクト雛形（ルートに書き込まれる） / Project skeleton written at the root */
  scaffold?: ScaffoldFile[];
  /** エージェント行動規範（CLAUDE.md）のマークダウン全文 / Agent guide markdown */
  claude_md: string;
  /** AI生成に失敗し、テンプレート雛形が返っている / True when this is the fallback scaffold */
  degraded?: boolean;
  /** フォールバックした理由（UIに表示する） / Why generation fell back */
  degradedReason?: string;
}

/** Identifies one generated document tab. / 生成ドキュメントのタブ識別子 */
export type DocKind = 'requirements' | 'design' | 'adr' | 'scaffold' | 'claude_md';
