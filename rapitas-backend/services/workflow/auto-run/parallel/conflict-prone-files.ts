/**
 * conflict-prone-files
 *
 * The files two parallel tasks must never both touch (task 1552, やること 8)
 * and the small glob matcher the parallel-safety rules share. Split out of
 * parallel-safety-rules.ts for the file-size limit. Not responsible for
 * judging a pair.
 */

/**
 * Files two parallel tasks must never both touch, with the reason. Matched as a
 * path suffix starting at a `/` boundary, so repo- and package-relative paths
 * both hit. `*` stays inside one segment, `**` spans any depth.
 */
export const CONFLICT_PRONE_FILE_RULES: ReadonlyArray<{ pattern: string; reason: string }> = [
  {
    pattern: 'rapitas-frontend/messages/en.json',
    reason: 'every task appends keys at the end, so two edits always conflict as text',
  },
  {
    pattern: 'rapitas-frontend/messages/ja.json',
    reason: 'every task appends keys at the end, so two edits always conflict as text',
  },
  { pattern: 'rapitas-backend/routes/*/index.ts', reason: 'generated route barrel' },
  { pattern: '.baselines/**', reason: 'line-count baselines that both tasks would rewrite' },
  {
    pattern: 'rapitas-backend/prisma/schema/**',
    reason: 'schema change needs a restart and CI checks generated-file sync',
  },
  {
    pattern: 'rapitas-backend/prisma/schema.desktop/**',
    reason: 'generated from the schema; CI checks it is in sync',
  },
  {
    pattern: 'rapitas-backend/src/generated/*-init-sql.ts',
    reason: 'generated from the schema; CI checks it is in sync',
  },
  { pattern: '**/package.json', reason: 'dependency change' },
  { pattern: 'pnpm-lock.yaml', reason: 'lockfile' },
  { pattern: 'bun.lock', reason: 'lockfile' },
  { pattern: 'bun.lockb', reason: 'lockfile' },
  { pattern: 'package-lock.json', reason: 'lockfile' },
  { pattern: 'Cargo.lock', reason: 'lockfile' },
  { pattern: '.env.example', reason: 'shared configuration' },
  { pattern: '**/eslint.config.mjs', reason: 'shared lint configuration changes every result' },
  { pattern: 'eslint-shared.mjs', reason: 'shared lint configuration changes every result' },
  { pattern: '**/tsconfig*.json', reason: 'shared compiler configuration' },
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
