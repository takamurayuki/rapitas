/**
 * plan-deviation/declaration-parser
 *
 * Extracts the structured plan declaration (files / commands / externalHosts)
 * from plan.md. The `json:plan-declaration` fence wins; without one, only
 * `files` is filled from the 変更予定ファイル section — commands and hosts
 * are never guessed. Decides the 『計画が曖昧』 state. Pure functions only.
 */
import { createHash } from 'crypto';
import { extractPlanDeclaredFiles } from '../plan-declared-files';
import type { ParsedDeclaration, PlanDeclaration } from './types';

/** Fence info string planners are instructed to emit. */
export const PLAN_DECLARATION_FENCE = 'json:plan-declaration';

const FENCE_RE = /```json:plan-declaration[^\n]*\n([\s\S]*?)```/;

/** Keep only non-empty trimmed strings, de-duplicated in order. */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Parse the fence body; null when absent or invalid (with a warning pushed). */
function readFence(planContent: string, warnings: string[]): PlanDeclaration | null {
  const m = FENCE_RE.exec(planContent);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]) as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      warnings.push(`${PLAN_DECLARATION_FENCE} block is not a JSON object`);
      return null;
    }
    return {
      version: 1,
      files: toStringList(raw.files),
      commands: toStringList(raw.commands),
      externalHosts: toStringList(raw.externalHosts).map((h) => h.toLowerCase()),
    };
  } catch (err) {
    warnings.push(
      `${PLAN_DECLARATION_FENCE} block could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Parse plan.md into a declaration and decide whether it is too vague to judge.
 *
 * @param planContent - plan.md text / plan.md の内容
 * @returns Declaration, its source, the ambiguous flag (files.length === 0) and warnings
 *   / 宣言・取得元・曖昧フラグ（変更ファイル0件）・警告
 */
export function parsePlanDeclaration(planContent: string | null | undefined): ParsedDeclaration {
  const warnings: string[] = [];
  const text = planContent ?? '';
  const fenced = text ? readFence(text, warnings) : null;
  if (fenced) {
    return { declaration: fenced, source: 'fence', ambiguous: fenced.files.length === 0, warnings };
  }
  const files = extractPlanDeclaredFiles(text);
  const declaration: PlanDeclaration = { version: 1, files, commands: [], externalHosts: [] };
  return {
    declaration,
    source: files.length > 0 ? 'fallback' : 'none',
    ambiguous: files.length === 0,
    warnings,
  };
}

/**
 * Short stable hash identifying a declaration (recorded in audits).
 *
 * @param declaration - Parsed declaration / 宣言
 * @returns First 16 hex chars of sha256 / sha256 先頭16桁
 */
export function hashDeclaration(declaration: PlanDeclaration): string {
  const canonical = JSON.stringify({
    files: declaration.files,
    commands: declaration.commands,
    externalHosts: declaration.externalHosts,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
