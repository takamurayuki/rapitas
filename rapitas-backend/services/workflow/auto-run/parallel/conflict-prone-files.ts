/**
 * conflict-prone-files
 *
 * The files two parallel tasks must never both touch (task 1552, やること 8)
 * and the small glob matcher the parallel-safety rules share. Split out of
 * parallel-safety-rules.ts for the file-size limit. Not responsible for
 * judging a pair.
 */

/**
 * How far a conflict-prone kind reaches.
 * - `pair`: the collision is textual or regenerated output, so it only happens
 *   when BOTH tasks touch the same kind (two schema edits, two message appends).
 * - `any`: the change alters what every other task builds or checks against
 *   (dependencies, shared config), so one side alone is enough to refuse.
 */
export type ConflictProneScope = 'pair' | 'any';

/** One conflict-prone file rule. */
export interface ConflictProneRule {
  /** Suffix glob. / パターン */
  pattern: string;
  /** Why it conflicts. / 理由 */
  reason: string;
  /** Rules with the same kind collide with each other. / 種類 */
  kind: string;
  /** See ConflictProneScope. / 効く範囲 */
  scope: ConflictProneScope;
}

/**
 * Files two parallel tasks must not both touch, with the reason. Matched as a
 * path suffix starting at a `/` boundary, so repo- and package-relative paths
 * both hit. `*` stays inside one segment, `**` spans any depth.
 *
 * NOTE: 2026-11-27 the user asked that a task not touching the schema may run
 * next to one that does. Pair-scoped kinds now refuse only when both sides hit
 * the same kind; before, one side alone refused every pair (task 1567 waited
 * behind 1553 although they shared no file).
 */
export const CONFLICT_PRONE_FILE_RULES: ReadonlyArray<ConflictProneRule> = [
  {
    pattern: 'rapitas-frontend/messages/en.json',
    reason: 'every task appends keys at the end, so two edits always conflict as text',
    kind: 'i18n-messages',
    scope: 'pair',
  },
  {
    pattern: 'rapitas-frontend/messages/ja.json',
    reason: 'every task appends keys at the end, so two edits always conflict as text',
    kind: 'i18n-messages',
    scope: 'pair',
  },
  {
    pattern: 'rapitas-backend/routes/*/index.ts',
    reason: 'generated route barrel',
    kind: 'route-barrel',
    scope: 'pair',
  },
  {
    pattern: '.baselines/**',
    reason: 'line-count baselines that both tasks would rewrite',
    kind: 'baselines',
    scope: 'pair',
  },
  {
    pattern: 'rapitas-backend/prisma/schema/**',
    reason: 'schema change needs a restart and CI checks generated-file sync',
    kind: 'schema',
    scope: 'pair',
  },
  {
    pattern: 'rapitas-backend/prisma/schema.desktop/**',
    reason: 'generated from the schema; CI checks it is in sync',
    kind: 'schema',
    scope: 'pair',
  },
  {
    pattern: 'rapitas-backend/src/generated/*-init-sql.ts',
    reason: 'generated from the schema; CI checks it is in sync',
    kind: 'schema',
    scope: 'pair',
  },
  { pattern: '**/package.json', reason: 'dependency change', kind: 'dependencies', scope: 'any' },
  { pattern: 'pnpm-lock.yaml', reason: 'lockfile', kind: 'dependencies', scope: 'any' },
  { pattern: 'bun.lock', reason: 'lockfile', kind: 'dependencies', scope: 'any' },
  { pattern: 'bun.lockb', reason: 'lockfile', kind: 'dependencies', scope: 'any' },
  { pattern: 'package-lock.json', reason: 'lockfile', kind: 'dependencies', scope: 'any' },
  { pattern: 'Cargo.lock', reason: 'lockfile', kind: 'dependencies', scope: 'any' },
  // NOTE: pair-scoped — it only lists variables, so one side editing it cannot break the other (2026-11-27).
  { pattern: '.env.example', reason: 'shared configuration', kind: 'env-example', scope: 'pair' },
  {
    pattern: '**/eslint.config.mjs',
    reason: 'shared lint configuration changes every result',
    kind: 'shared-config',
    scope: 'any',
  },
  {
    pattern: 'eslint-shared.mjs',
    reason: 'shared lint configuration changes every result',
    kind: 'shared-config',
    scope: 'any',
  },
  {
    pattern: '**/tsconfig*.json',
    reason: 'shared compiler configuration',
    kind: 'shared-config',
    scope: 'any',
  },
];

/** Package folders plans omit when they write package-relative paths. */
export const PACKAGE_DIR_RE = /^rapitas-(?:backend|frontend|desktop|mobile)\//;
/** Glob literal prefixes this shallow are too wide to compare (e.g. `rapitas-backend/services/`). */
export const MIN_PATTERN_PREFIX_SEGMENTS = 3;

/** Forward slashes, no leading `./`. */
export const normPath = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a glob (`*`, `**` only) into a suffix regex anchored at `/` or start.
 *
 * @param glob - Pattern / パターン
 * @returns Regex / 正規表現
 */
export function globToSuffixRegex(glob: string): RegExp {
  let body = '';
  const g = normPath(glob);
  for (let i = 0; i < g.length; i++) {
    if (g.startsWith('**/', i)) {
      body += '(?:.*/)?';
      i += 2;
    } else if (g.startsWith('**', i)) {
      body += '.*';
      i += 1;
    } else if (g[i] === '*') {
      body += '[^/]*';
    } else {
      body += escapeRe(g[i]!);
    }
  }
  return new RegExp(`(?:^|/)${body}$`);
}

/**
 * Whether `file` matches `glob`, also trying the glob without its package folder.
 *
 * @param glob - Pattern / パターン
 * @param file - Path / パス
 * @returns Match / 一致するか
 */
export function globHits(glob: string, file: string): boolean {
  const f = normPath(file);
  if (globToSuffixRegex(glob).test(f)) return true;
  const stripped = normPath(glob).replace(PACKAGE_DIR_RE, '');
  return stripped !== normPath(glob) && globToSuffixRegex(stripped).test(f);
}
