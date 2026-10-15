/**
 * requirements-task-plan
 *
 * Turns a generated project's requirements.md into one implementation-task spec
 * per `[F-NN]` feature.
 * Not responsible for creating tasks or reading files — callers own both, so
 * the parse stays pure and testable.
 */

/** One feature, ready to become a task. */
export interface RequirementTaskSpec {
  /** Feature id as written, e.g. `F-01`. */
  id: string;
  /** Short feature name from the bullet's first line. */
  title: string;
  /** The feature's 入力/処理/出力 body, verbatim. */
  detail: string;
  /** Given/When/Then lines keyed by the same id, or empty when absent. */
  acceptanceCriteria: string[];
}

/**
 * A feature declaration: `[F-01]` plus whatever markdown wraps it.
 *
 * Accepts a list bullet, a sub-heading (`##`..`######`), an optional task
 * checkbox, an optional bold wrapper and an optional colon, because the shape
 * is not under our control and a shape we reject costs an entire project's
 * tasks with no error anywhere:
 * - `- [F-01] 名前` — the canonical form the prompt asks for.
 * - `### [F-01] 名前` — what the live generator produced on 2026-10-12, since
 *   each feature carries an 入力/処理/出力 block under it.
 * - `- **[F-01] 名前**` — what the fallback template produced on 2026-10-11.
 * - `- [ ] [F-01] Given … When … Then …` — criteria written as a checklist.
 *
 * Group 1 is the id, group 2 the remaining text with the wrapper stripped.
 */
const FEATURE_DECLARATION =
  /^[ \t]*(?:[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|#{2,6}[ \t]+)?\*{0,2}[ \t]*[[［][ \t]*(F-\d+)[ \t]*[\]］]\*{0,2}[ \t]*[:：]?[ \t]*(.*?)[ \t]*\*{0,2}[ \t]*$/;

/** One feature declaration line, parsed. */
interface FeatureLine {
  id: string;
  /** The text after the id, wrapper and colon removed. / ID以降の本文 */
  text: string;
}

/**
 * Parse a line as a feature declaration.
 *
 * NOTE: Exported so spec-consistency.ts and spec-drift.ts read the SAME shapes
 * the filer accepts. A second copy would let the checker pass a document the
 * filer then reads as empty.
 *
 * @param line - One markdown line / markdown の1行
 * @returns The id and text, or null when the line declares no feature / 解析結果
 */
export function matchFeatureLine(line: string): FeatureLine | null {
  const m = line.match(FEATURE_DECLARATION);
  if (!m) return null;
  return { id: m[1], text: m[2].replace(/^\*{1,2}|\*{1,2}$/g, '').trim() };
}

/**
 * A TOP-LEVEL section heading only.
 *
 * NOTE: the negative lookahead matters. Without it `### [F-01] …` matched as a
 * heading, so a 機能要件 section whose features are written as sub-headings
 * ended at its very first feature and the document parsed as having none —
 * measured 2026-10-12 against the live generator.
 */
const HEADING = /^#(?!#)[ \t]*(.+?)[ \t]*$/;

/**
 * The lines belonging to a `# <name>` section, excluding the heading itself.
 *
 * @param markdown - Document to read / 対象の文書
 * @param name - Exact heading text, without the `#` / `#` を除いた見出し文字列
 * @returns The section's lines, or [] when the heading is absent / 見出しが無ければ []
 */
export function sectionLines(markdown: string, name: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = l.match(HEADING);
    return m ? m[1] === name : false;
  });
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => HEADING.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * Acceptance criteria indexed by feature id.
 *
 * NOTE: A feature with no criterion gets an empty list rather than a borrowed
 * one. An unverifiable task is recoverable; a task measured against another
 * feature's bar silently verifies the wrong thing.
 */
function criteriaById(markdown: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of sectionLines(markdown, '受け入れ基準')) {
    const m = matchFeatureLine(line);
    if (!m?.text) continue;
    const list = out.get(m.id) ?? [];
    list.push(m.text);
    out.set(m.id, list);
  }
  return out;
}

/**
 * One task spec per feature in the 機能要件 section.
 *
 * NOTE: Scoped to that section on purpose — the acceptance-criteria section
 * repeats every `[F-NN]`, so scanning the whole document would double every
 * task.
 *
 * @param markdown - requirements.md content / requirements.md の内容
 * @returns Specs in document order / 文書順のタスク仕様
 */
export function parseRequirementTasks(markdown: string): RequirementTaskSpec[] {
  if (!markdown) return [];
  const criteria = criteriaById(markdown);
  const specs: RequirementTaskSpec[] = [];
  let current: RequirementTaskSpec | null = null;
  const body: string[] = [];

  const flush = () => {
    if (!current) return;
    current.detail = body.join('\n').trim();
    specs.push(current);
    body.length = 0;
  };

  for (const line of sectionLines(markdown, '機能要件')) {
    const m = matchFeatureLine(line);
    if (m) {
      flush();
      current = {
        id: m.id,
        title: m.text,
        detail: '',
        acceptanceCriteria: criteria.get(m.id) ?? [],
      };
      continue;
    }
    if (current) body.push(line);
  }
  flush();
  return specs;
}

/**
 * The explicit non-goals, so a task can carry them as constraints.
 *
 * @param markdown - requirements.md content / requirements.md の内容
 * @returns Out-of-scope bullets / スコープ外の項目
 */
export function outOfScopeItems(markdown: string): string[] {
  return sectionLines(markdown, 'スコープ外')
    .map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim() ?? '')
    .filter(Boolean);
}
