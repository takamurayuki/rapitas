import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { ReactNode, HTMLAttributes, CSSProperties } from "react";

// vscDarkPlusのスタイル型
type SyntaxHighlighterStyle = { [key: string]: CSSProperties };

type MarkdownNode = {
  children?: Array<{
    type: string;
    tagName?: string;
  }>;
};

type ParagraphProps = HTMLAttributes<HTMLParagraphElement> & {
  node?: MarkdownNode;
  children?: ReactNode;
};

type CodeProps = HTMLAttributes<HTMLElement> & {
  node?: MarkdownNode;
  inline?: boolean;
  className?: string;
  children?: ReactNode;
};

// マークダウン用カスタムコンポーネント（編集ボタン付き）
export const createMarkdownComponents = (
  onEditCode?: (language: string, code: string) => void,
) => ({
  // pタグの処理をカスタマイズ（pre/codeを含む場合は div に変換）
  p({ node, children, ...props }: ParagraphProps) {
    // 子要素に pre や code ブロックが含まれているかチェック
    const hasCodeBlock = node?.children?.some(
      (child) =>
        child.type === "element" &&
        (child.tagName === "pre" || child.tagName === "code"),
    );

    if (hasCodeBlock) {
      return <div {...props}>{children}</div>;
    }
    return <p {...props}>{children}</p>;
  },
  code({ inline, className, children, style: _style, ...props }: CodeProps) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const codeString = String(children).replace(/\n$/, "");
    // _styleは使用しない（SyntaxHighlighterのstyleと競合するため）
    void _style;

    // インラインコード
    if (inline) {
      return (
        <code
          className="inline bg-zinc-100 dark:bg-indigo-dark-800 px-1.5 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200"
          {...props}
        >
          {children}
        </code>
      );
    }

    // コードブロック（言語指定あり）
    if (language) {
      return (
        <div className="relative group my-4">
          <div className="absolute top-0 right-0 flex items-center gap-2">
            <span className="px-3 py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-indigo-dark-800 rounded-bl-lg border-l border-b border-zinc-300 dark:border-zinc-700">
              {language.toUpperCase()}
            </span>
            {onEditCode && (
              <button
                onClick={() => onEditCode(language, codeString)}
                className="opacity-0 group-hover:opacity-100 transition-opacity px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-bl-lg rounded-tr-lg"
              >
                編集
              </button>
            )}
          </div>
          <SyntaxHighlighter
            style={vscDarkPlus as unknown as SyntaxHighlighterStyle}
            language={language}
            PreTag="div"
            className="mt-0! mb-0! rounded-lg! text-sm!"
            showLineNumbers={true}
            customStyle={{
              margin: 0,
              borderRadius: "0.5rem",
              padding: "1rem",
            }}
            {...props}
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      );
    }

    // コードブロック（言語指定なし）
    return (
      <div className="bg-zinc-100 dark:bg-indigo-dark-800 p-4 rounded-lg overflow-x-auto my-4">
        <code
          className="block text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre"
          {...props}
        >
          {children}
        </code>
      </div>
    );
  },
});
