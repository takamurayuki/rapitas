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

/** `[F-01]`, tolerating full-width brackets and surrounding spaces. */
const FEATURE_BULLET = /^\s*[-*]\s*[[［]\s*(F-\d+)\s*[\]］]\s*(.*)$/;
/** A top-level section heading. */
const HEADING = /^#\s*(.+?)\s*$/;

/** The lines belonging to a `# <name>` section, excluding the heading itself. */
function sectionLines(markdown: string, name: string): string[] {
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
    const m = line.match(FEATURE_BULLET);
    if (!m?.[2]?.trim()) continue;
    const list = out.get(m[1]) ?? [];
    list.push(m[2].trim());
    out.set(m[1], list);
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
    const m = line.match(FEATURE_BULLET);
    if (m) {
      flush();
      current = {
        id: m[1],
        title: (m[2] ?? '').trim(),
        detail: '',
        acceptanceCriteria: criteria.get(m[1]) ?? [],
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
