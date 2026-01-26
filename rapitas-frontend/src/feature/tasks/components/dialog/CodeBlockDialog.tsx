import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createMarkdownComponents } from "@/feature/tasks/components/MarkdownComponents";

// プログラミング言語リスト
const PROGRAMMING_LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash/Shell" },
  { value: "powershell", label: "PowerShell" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "markdown", label: "Markdown" },
  { value: "php", label: "PHP" },
  { value: "ruby", label: "Ruby" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "plaintext", label: "プレーンテキスト" },
];

interface CodeBlockDialogProps {
  show: boolean;
  isEditing: boolean;
  language: string;
  content: string;
  onLanguageChange: (language: string) => void;
  onContentChange: (content: string) => void;
  onInsert: () => void;
  onCancel: () => void;
}

export default function CodeBlockDialog({
  show,
  isEditing,
  language,
  content,
  onLanguageChange,
  onContentChange,
  onInsert,
  onCancel,
}: CodeBlockDialogProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-800 w-full max-w-3xl max-h-[90vh] overflow-auto">
        <div className="p-6">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-4">
            {isEditing ? "コードブロックを編集" : "コードブロックを追加"}
          </h3>

          {/* 言語選択 */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              プログラミング言語
            </label>
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PROGRAMMING_LANGUAGES.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* コード入力 */}
          <div className="mb-4">
            <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
              コード
            </label>
            <textarea
              value={content}
              onChange={(e) => onContentChange(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
              rows={12}
              placeholder="ここにコードを入力してください..."
            />
          </div>

          {/* プレビュー */}
          {content && (
            <div className="mb-4">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                プレビュー
              </label>
              <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={createMarkdownComponents()}
                >
                  {`\`\`\`${language}\n${content}\n\`\`\``}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* ボタン */}
          <div className="flex gap-3">
            <button
              onClick={onInsert}
              disabled={!content.trim()}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-zinc-400 disabled:cursor-not-allowed"
            >
              {isEditing ? "更新" : "挿入"}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            >
              キャンセル
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
