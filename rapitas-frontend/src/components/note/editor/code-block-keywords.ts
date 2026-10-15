/**
 * code-block-keywords
 *
 * Per-language keyword tables and comment-syntax classification sets used by the
 * code-block tokenizer. Pure data only — no tokenizing or rendering logic here.
 * The per-language-family tables live under ./keyword-tables/ and are merged
 * here to keep this barrel's exported names (KEYWORDS, C_COMMENT_LANGS,
 * HASH_COMMENT_LANGS) unchanged for existing consumers.
 */

import { WEB_LANGUAGE_KEYWORDS } from './keyword-tables/web-language-keywords';
import { SYSTEMS_LANGUAGE_KEYWORDS } from './keyword-tables/systems-language-keywords';
import { DATA_LANGUAGE_KEYWORDS } from './keyword-tables/data-language-keywords';

// ─── Language keyword tables ─────────────────────────────────────────────────

export const KEYWORDS: Record<string, string[]> = {
  ...WEB_LANGUAGE_KEYWORDS,
  ...SYSTEMS_LANGUAGE_KEYWORDS,
  ...DATA_LANGUAGE_KEYWORDS,
};

// Languages that use C-style // and /* */ comments.
export const C_COMMENT_LANGS = new Set([
  'javascript',
  'typescript',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'swift',
  'kotlin',
  'php',
  'css',
  'scss',
]);

// Languages that use # line comments.
export const HASH_COMMENT_LANGS = new Set([
  'python',
  'ruby',
  'bash',
  'shell',
  'powershell',
  'yaml',
]);
