/**
 * playbook-types
 *
 * Shared types for the playbook subsystem: auto-distilled procedure documents
 * generated from clusters of same-shaped completed tasks. Types only — no
 * runtime logic.
 */

/** One completed task considered for playbook clustering. */
export interface PlaybookCandidate {
  /** Task id. / タスクID */
  taskId: number;
  /** Task title (similarity probe). / タスクタイトル */
  title: string;
  /** Normalized changed-file paths parsed from verify/plan artifacts. / 変更ファイル群 */
  files: string[];
  /** Optional artifact excerpt attached for prompt building. / プロンプト用抜粋 */
  artifactExcerpt?: string;
}

/** A cluster of same-shaped completed tasks (current task first). */
export interface PlaybookCluster {
  /** Cluster members, the just-completed task first. / メンバー(先頭が当該タスク) */
  members: PlaybookCandidate[];
}

/** Successfully parsed AI playbook output. */
export interface ParsedPlaybook {
  parseFailed: false;
  /** Playbook title. / 手順書タイトル */
  title: string;
  /** Markdown body incl. `## 対象ファイル` section. / 手順書本文 */
  content: string;
}

/** Structural parse failure (fail-open: nothing is stored). */
export interface PlaybookParseFailure {
  parseFailed: true;
}

/** Union returned by parsePlaybookResult. */
export type PlaybookParseResult = ParsedPlaybook | PlaybookParseFailure;
