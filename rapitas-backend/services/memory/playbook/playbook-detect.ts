/**
 * playbook-detect
 *
 * Pure detection/selection functions for the playbook subsystem: changed-file
 * extraction from workflow artifacts, title/file-set similarity, same-shape
 * cluster detection, and injection ranking. No I/O — fully unit-testable.
 */
import { bigramJaccard } from '../theme-saturation';
import type { PlaybookCandidate, PlaybookCluster } from './playbook-types';

/** Minimum title bigram-Jaccard for two tasks to count as same-shaped (CBR's MIN_SIMILARITY). */
export const TITLE_MIN_SIMILARITY = 0.25;
/** Minimum changed-file-set Jaccard — file overlap is REQUIRED, title alone is too noisy. */
export const FILESET_MIN_JACCARD = 0.34;
/** Completed tasks scanned for cluster candidates (matches outcome-telemetry's window). */
export const RECENT_WINDOW = 10;
/** Playbooks injected per task. */
export const MAX_PLAYBOOKS = 1;

/** File-path token inside backticks (same shape as scope-check's PATHISH_RE). */
const PATHISH_RE = /^[\w.@-]+(?:[/\\][\w.@[\]-]+)*\.[A-Za-z]{1,6}$/;

/**
 * Normalize one backtick token into a comparable file path, or null when the
 * token is not path-like (prose, commands, line-number suffixes are stripped).
 */
function normalizePathToken(raw: string): string | null {
  const token = raw
    .trim()
    .replace(/:(\d+)(:\d+)?$/, '')
    .replace(/\\/g, '/');
  if (!token || /\s/.test(token)) return null;
  return PATHISH_RE.test(token) ? token : null;
}

/**
 * Extract changed-file paths from a workflow artifact's Markdown tables
 * (verify.md's 変更ファイル table / plan.md's 変更予定ファイル table).
 * Only table rows are scanned — backtick paths in prose are NOT changed-file
 * claims. Returns [] when the artifact has no table.
 *
 * @param md - Artifact markdown (verify/plan). / 成果物本文
 * @returns Unique normalized (forward-slash) paths. / 正規化済みパス一覧
 */
export function extractChangedFiles(md: string): string[] {
  const out = new Set<string>();
  if (!md) return [];
  for (const line of md.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const token = normalizePathToken(m[1]);
      if (token) out.add(token);
    }
  }
  return [...out];
}

/**
 * Extract the target-file paths a playbook's `## 対象ファイル` section lists
 * (one backtick path per line). Used by the freshness gate — the SAME backtick
 * convention as extractChangedFiles, but scoped to that section only.
 *
 * @param content - Playbook markdown body. / 手順書本文
 * @returns Unique normalized paths, [] when the section is missing. / パス一覧
 */
export function extractPlaybookTargetFiles(content: string): string[] {
  const out = new Set<string>();
  if (!content) return [];
  const lines = content.split('\n');
  let inSection = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inSection = /^##\s*対象ファイル/.test(line);
      continue;
    }
    if (!inSection) continue;
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const token = normalizePathToken(m[1]);
      if (token) out.add(token);
    }
  }
  return [...out];
}

/**
 * Jaccard similarity of two file-path sets (0..1). Empty input on either side
 * yields 0 — a task with no known changed files can never match.
 *
 * @param a - First file set. / ファイル集合A
 * @param b - Second file set. / ファイル集合B
 * @returns Set Jaccard in [0,1]. / Jaccard係数
 */
export function fileSetJaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const f of A) if (B.has(f)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Detect whether the just-completed task forms a same-shape cluster with past
 * completed tasks. A candidate matches when BOTH the title similarity and the
 * changed-file-set similarity clear their thresholds (AND — title alone is too
 * noisy, files alone match unrelated work in hot directories). One match is
 * enough: current + match = the required "2 or more same-shaped tasks".
 *
 * @param current - The just-completed task. / 完了直後のタスク
 * @param candidates - Recent completed tasks. / 走査窓内の過去完了タスク
 * @returns Cluster (current first) or null. / クラスタまたはnull
 */
export function detectPlaybookCluster(
  current: PlaybookCandidate,
  candidates: PlaybookCandidate[],
): PlaybookCluster | null {
  const matches = candidates.filter(
    (c) =>
      c.taskId !== current.taskId &&
      bigramJaccard(current.title, c.title) >= TITLE_MIN_SIMILARITY &&
      fileSetJaccard(current.files, c.files) >= FILESET_MIN_JACCARD,
  );
  if (matches.length === 0) return null;
  return { members: [current, ...matches] };
}

/**
 * Rank stored playbooks against a task's title/description probes by bigram
 * title similarity (max over probes — a long description would otherwise
 * drown the Jaccard union). Pure; freshness is deliberately NOT part of the
 * ranking (the caller's freshness gate handles it with I/O).
 *
 * @param probes - Task title (+ description) probes. / 照合文字列
 * @param playbooks - Stored playbook entries. / プレイブック候補
 * @returns Candidates at/above TITLE_MIN_SIMILARITY, best first. / 類似度順
 */
export function rankPlaybooks<T extends { id: number; title: string }>(
  probes: string | string[],
  playbooks: T[],
): Array<T & { similarity: number }> {
  const probeList = (Array.isArray(probes) ? probes : [probes]).filter((p) => p.trim());
  return playbooks
    .map((p) => ({
      ...p,
      similarity: probeList.reduce(
        (best, probe) => Math.max(best, bigramJaccard(probe, p.title)),
        0,
      ),
    }))
    .filter((p) => p.similarity >= TITLE_MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity);
}
