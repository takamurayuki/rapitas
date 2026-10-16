'use client';

/**
 * syntax-highlighted-code
 *
 * PrismAsyncLight-based code-block highlighter shared by task markdown, the file
 * viewer, and note chat. Keeps every react-syntax-highlighter import (component
 * and theme objects) inside this lazily-loaded module so the heavyweight
 * grammar bundle stays out of eager chunks. Not responsible for inline code or
 * language-less blocks — callers keep their own immediate render paths.
 */

import type { CSSProperties, HTMLProps } from 'react';
// NOTE: type-only import, erased at compile time — pulls @types/react-syntax-highlighter's
// ambient declarations for the dist/esm subpaths into the program without
// bundling the package root (no other file imports the root anymore).
import type {} from 'react-syntax-highlighter';
// NOTE: PrismAsyncLight (not Prism/PrismAsync) — auto-loads each requested
// language grammar as its own small async chunk with no registerLanguage calls
// (every supported language still highlights). PrismAsync would pull
// refractor/all into a single ~585KB chunk, violating the 500KB chunk budget.
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-async-light';
import { vscDarkPlus, oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

/** Theme keys accepted by the shared highlighter. / 共有ハイライタが受けるテーマキー */
export type SyntaxHighlightTheme = 'vscDarkPlus' | 'oneDark' | 'oneLight';

type SyntaxHighlighterStyle = { [key: string]: CSSProperties };

// NOTE: Theme objects resolve here (not at call sites) so the style modules
// also stay inside this lazy chunk — callers pass only the string key.
const THEMES: Record<SyntaxHighlightTheme, SyntaxHighlighterStyle> = {
  vscDarkPlus: vscDarkPlus as SyntaxHighlighterStyle,
  oneDark: oneDark as SyntaxHighlighterStyle,
  oneLight: oneLight as SyntaxHighlighterStyle,
};

export interface SyntaxHighlightedCodeProps {
  /** Code-fence body to highlight. / ハイライト対象のコード文字列 */
  code: string;
  /** Prism language identifier. / Prismの言語識別子 */
  language: string;
  /** Color theme key. / 配色テーマキー */
  theme: SyntaxHighlightTheme;
  /** Whether to render line numbers. / 行番号を表示するか */
  showLineNumbers?: boolean;
  /** Inline style overrides for the outer tag. / 外側タグのインラインスタイル */
  customStyle?: CSSProperties;
  /** Extra classes for the outer tag. / 外側タグの追加クラス */
  className?: string;
  /** Outer wrapper tag. / 外側ラッパータグ */
  preTag?: 'div' | 'pre';
  /** Props forwarded to the inner code tag. / 内側codeタグへ転送するprops */
  codeTagProps?: HTMLProps<HTMLElement>;
}

/**
 * Renders a highlighted code block via PrismAsync (grammars load on demand).
 *
 * @param props - Highlighting options mapped 1:1 from the former static call sites. / 旧静的呼出箇所から1:1で移送したオプション
 * @returns Highlighted code block element. / ハイライト済みコードブロック要素
 */
export default function SyntaxHighlightedCode({
  code,
  language,
  theme,
  showLineNumbers,
  customStyle,
  className,
  preTag = 'pre',
  codeTagProps,
}: SyntaxHighlightedCodeProps) {
  return (
    <SyntaxHighlighter
      style={THEMES[theme]}
      language={language}
      PreTag={preTag}
      className={className}
      showLineNumbers={showLineNumbers}
      customStyle={customStyle}
      codeTagProps={codeTagProps}
    >
      {code}
    </SyntaxHighlighter>
  );
}
