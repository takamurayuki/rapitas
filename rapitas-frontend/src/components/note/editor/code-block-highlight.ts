/**
 * code-block-highlight
 *
 * Syntax highlighting logic for the note editor's code blocks.
 * Responsible for converting plain text code into HTML with inline color spans.
 * Not responsible for DOM structure or keyboard interaction.
 */

/** Language-specific keywords map used by the highlighter. */
const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  javascript: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'import',
    'export',
    'default',
    'from',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'finally',
  ],
  typescript: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'import',
    'export',
    'default',
    'from',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'finally',
    'interface',
    'type',
    'enum',
    'implements',
    'private',
    'public',
    'protected',
  ],
  python: [
    'def',
    'class',
    'if',
    'else',
    'elif',
    'for',
    'while',
    'return',
    'import',
    'from',
    'as',
    'try',
    'except',
    'finally',
    'with',
    'lambda',
    'yield',
    'pass',
    'break',
    'continue',
    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'in',
    'is',
  ],
  java: [
    'public',
    'private',
    'protected',
    'class',
    'interface',
    'extends',
    'implements',
    'static',
    'final',
    'void',
    'int',
    'String',
    'boolean',
    'if',
    'else',
    'for',
    'while',
    'return',
    'new',
    'this',
    'super',
    'try',
    'catch',
    'finally',
    'throw',
    'throws',
  ],
};

// Languages that use C-style // and block comments.
const C_STYLE_COMMENT_LANGS = [
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
];

/** Languages that use `#` line comments. */
const HASH_COMMENT_LANGS = ['python', 'ruby', 'bash', 'powershell', 'yaml'];

/**
 * Syntax-highlight code text for a given language.
 * Returns HTML string with inline color spans.
 *
 * @param text - Raw source code text / ハイライトするソースコード
 * @param lang - Language identifier (e.g. "typescript") / 言語識別子
 * @returns HTML string with highlight spans / ハイライト済みHTML文字列
 */
export function highlightCode(text: string, lang: string): string {
  // HTML escape first to prevent XSS from user code
  let highlighted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Language-specific keywords
  const langKeywords = LANGUAGE_KEYWORDS[lang] ?? [];
  if (langKeywords.length > 0) {
    const keywordRegex = new RegExp(`\\b(${langKeywords.join('|')})\\b`, 'g');
    highlighted = highlighted.replace(
      keywordRegex,
      '<span style="color: #c792ea;">$1</span>',
    );
  }

  // String highlighting (single, double, and backtick quotes)
  highlighted = highlighted.replace(
    /(["'`])(?:(?=(\\?))\2.)*?\1/g,
    '<span style="color: #c3e88d;">$&</span>',
  );

  // Comment highlighting — strategy depends on language family
  if (C_STYLE_COMMENT_LANGS.includes(lang)) {
    highlighted = highlighted.replace(
      /(\/\/.*$)/gm,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
    highlighted = highlighted.replace(
      /(\/\*[\s\S]*?\*\/)/g,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  } else if (HASH_COMMENT_LANGS.includes(lang)) {
    highlighted = highlighted.replace(
      /(#.*$)/gm,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  } else if (['html', 'xml'].includes(lang)) {
    highlighted = highlighted.replace(
      /(<!--[\s\S]*?-->)/g,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  } else if (lang === 'css') {
    highlighted = highlighted.replace(
      /(\/\*[\s\S]*?\*\/)/g,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  }

  // Number highlighting
  highlighted = highlighted.replace(
    /\b(\d+(?:\.\d+)?)\b/g,
    '<span style="color: #f78c6c;">$1</span>',
  );

  return highlighted;
}
