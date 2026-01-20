"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import type { Project, Milestone, Priority } from "@/types";
import { priorityColors, priorityLabels } from "@/types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

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

type SubtaskInput = {
  id: string;
  title: string;
  description: string;
  labels: string;
  estimatedHours: string;
};

// マークダウン用カスタムコンポーネント
const MarkdownComponents = {
  // pタグの処理をカスタマイズ（pre/codeを含む場合は div に変換）
  p({ node, children, ...props }: any) {
    // 子要素に pre や code ブロックが含まれているかチェック
    const hasCodeBlock = node?.children?.some(
      (child: any) =>
        child.type === "element" &&
        (child.tagName === "pre" || child.tagName === "code"),
    );

    if (hasCodeBlock) {
      return <div {...props}>{children}</div>;
    }
    return <p {...props}>{children}</p>;
  },
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const codeString = String(children).replace(/\n$/, "");

    // インラインコード
    if (inline) {
      return (
        <code
          className="inline bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200"
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
          <div className="absolute top-0 right-0 px-3 py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-200 dark:bg-zinc-700 rounded-bl-lg rounded-tr-lg border-l border-b border-zinc-300 dark:border-zinc-600">
            {language.toUpperCase()}
          </div>
          <SyntaxHighlighter
            style={vscDarkPlus}
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
      <div className="bg-zinc-200 dark:bg-zinc-700 p-4 rounded-lg overflow-x-auto my-4">
        <code
          className="block text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre"
          {...props}
        >
          {children}
        </code>
      </div>
    );
  },
};

export default function NewTaskPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [labels, setLabels] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [status, setStatus] = useState("todo");
  const [priority, setPriority] = useState<Priority>("medium");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [milestoneId, setMilestoneId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [subtasks, setSubtasks] = useState<SubtaskInput[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showCodeBlockDialog, setShowCodeBlockDialog] = useState(false);
  const [codeBlockLanguage, setCodeBlockLanguage] = useState("javascript");
  const [codeBlockContent, setCodeBlockContent] = useState("");

  // ファイル・画像アップロード用の状態
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (projectId) {
      fetchMilestones(projectId);
    } else {
      setMilestones([]);
      setMilestoneId(null);
    }
  }, [projectId]);

  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE}/projects`);
      const data = await res.json();
      setProjects(data);
    } catch (error) {
      console.error("Failed to fetch projects:", error);
    }
  };

  const fetchMilestones = async (projectId: number) => {
    try {
      const res = await fetch(`${API_BASE}/milestones?projectId=${projectId}`);
      const data = await res.json();
      setMilestones(data);
    } catch (error) {
      console.error("Failed to fetch milestones:", error);
    }
  };

  // サブタスク入力フォーム用の状態
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskLabels, setSubtaskLabels] = useState("");
  const [subtaskEstimatedHours, setSubtaskEstimatedHours] = useState("");
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [expandedSubtasks, setExpandedSubtasks] = useState<Set<string>>(
    new Set(),
  );

  const insertCodeBlock = () => {
    const codeBlock = `\n\`\`\`${codeBlockLanguage}\n${codeBlockContent}\n\`\`\`\n`;
    setDescription(description + codeBlock);
    setCodeBlockContent("");
    setCodeBlockLanguage("javascript");
    setShowCodeBlockDialog(false);
  };

  const handleFileDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    for (const file of files) {
      // 画像ファイルの場合
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          const imageMarkdown = `\n![${file.name}](${base64})\n`;
          setDescription(description + imageMarkdown);
        };
        reader.readAsDataURL(file);
      } else {
        // その他のファイル（テキストファイルなど）
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          const fileMarkdown = `\n**📎 ${file.name}**\n\`\`\`\n${content}\n\`\`\`\n`;
          setDescription(description + fileMarkdown);
        };
        reader.readAsText(file);
      }
    }
  };

  const addSubtask = () => {
    if (!subtaskTitle.trim()) return;

    const newSubtask: SubtaskInput = {
      id: Date.now().toString(),
      title: subtaskTitle,
      description: subtaskDescription,
      labels: subtaskLabels,
      estimatedHours: subtaskEstimatedHours,
    };

    setSubtasks([...subtasks, newSubtask]);

    // フォームをリセット
    setSubtaskTitle("");
    setSubtaskDescription("");
    setSubtaskLabels("");
    setSubtaskEstimatedHours("");
    setIsAddingSubtask(false);
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
    // 削除したサブタスクが展開されていた場合、展開状態も削除
    const newExpanded = new Set(expandedSubtasks);
    newExpanded.delete(id);
    setExpandedSubtasks(newExpanded);
  };

  const updateSubtask = (
    id: string,
    field: keyof SubtaskInput,
    value: string,
  ) => {
    setSubtasks(
      subtasks.map((st) => (st.id === id ? { ...st, [field]: value } : st)),
    );
  };

  const toggleSubtaskExpanded = (id: string) => {
    const newExpanded = new Set(expandedSubtasks);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSubtasks(newExpanded);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      const labelArray = labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      // メインタスクを作成
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          status,
          priority,
          categoryId: categoryId || undefined,
          projectId: projectId || undefined,
          milestoneId: milestoneId || undefined,
          labels: labelArray.length > 0 ? labelArray : undefined,
          estimatedHours: estimatedHours
            ? parseFloat(estimatedHours)
            : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("タスクの作成に失敗しました");
      }

      const createdTask = await res.json();

      // サブタスクを作成
      if (subtasks.length > 0) {
        const subtaskPromises = subtasks
          .filter((st) => st.title.trim())
          .map((st) => {
            const stLabelArray = st.labels
              .split(",")
              .map((l) => l.trim())
              .filter(Boolean);

            return fetch(`${API_BASE}/tasks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                title: st.title,
                description: st.description || undefined,
                status: "todo",
                labels: stLabelArray.length > 0 ? stLabelArray : undefined,
                estimatedHours: st.estimatedHours
                  ? parseFloat(st.estimatedHours)
                  : undefined,
                parentId: createdTask.id,
              }),
            });
          });

        await Promise.all(subtaskPromises);
      }

      router.push("/");
    } catch (err) {
      console.error(err);
      alert("タスクの作成に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-3xl mx-auto p-6">
        {/* アクションボタン */}
        <div className="flex gap-3 justify-end mb-6">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="px-6 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            disabled={isSubmitting}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="px-6 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={isSubmitting}
          >
            {isSubmitting ? "作成中..." : "タスクを作成"}
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
            {/* タイトル */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                タイトル <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="タスクのタイトルを入力"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                autoFocus
              />
            </div>

            {/* 説明 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  説明
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCodeBlockDialog(true)}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-md transition-colors"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                    コードブロック追加
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPreview(!showPreview)}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {showPreview ? "編集" : "プレビュー"}
                  </button>
                </div>
              </div>

              {showPreview ? (
                <div className="min-h-[150px] rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 px-4 py-3">
                  {description ? (
                    <div
                      className="prose prose-sm prose-zinc dark:prose-invert max-w-none
                      prose-headings:font-bold 
                      prose-h1:text-2xl prose-h1:mt-4 prose-h1:mb-2
                      prose-h2:text-xl prose-h2:mt-3 prose-h2:mb-2
                      prose-h3:text-lg prose-h3:mt-2 prose-h3:mb-1
                      prose-p:my-2 prose-p:leading-relaxed
                      prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
                      prose-pre:bg-zinc-200 prose-pre:dark:bg-zinc-700 
                      prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
                      prose-blockquote:border-l-4 prose-blockquote:border-zinc-300 
                      prose-blockquote:dark:border-zinc-700 prose-blockquote:pl-4 
                      prose-blockquote:italic prose-blockquote:text-zinc-600 
                      prose-blockquote:dark:text-zinc-400
                      prose-ul:my-2 prose-ol:my-2 prose-li:my-1
                      [&_code]:bg-zinc-200 [&_code]:dark:bg-zinc-700 
                      [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded 
                      [&_code]:text-sm [&_code]:font-mono
                      [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
                      [&_code]:before:content-[''] [&_code]:after:content-['']
                      [&_pre_code]:bg-transparent [&_pre_code]:p-0"
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={MarkdownComponents}
                      >
                        {description}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400 dark:text-zinc-500 italic">
                      プレビューする内容がありません
                    </p>
                  )}
                </div>
              ) : (
                <textarea
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  placeholder="# タスクの詳細説明&#10;&#10;## 実装内容&#10;- [ ] API作成&#10;- [ ] フロント実装&#10;&#10;`npm install` でインストール&#10;&#10;コードブロックは「コードブロック追加」ボタンから挿入&#10;ファイルや画像はドラッグ&ドロップで添付可能"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleFileDrop}
                  rows={12}
                />
              )}
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-2">
                <span className="font-semibold">コードブロック:</span> ```言語名
                の後に改行してコードを記述（例: ```javascript）
                <br />
                <span className="font-semibold">対応言語:</span> javascript,
                typescript, python, java, go, rust, sql, bash, css, html, json,
                yaml, php, ruby など
                <br />
                <span className="font-semibold">インラインコード:</span>{" "}
                `backtick` で囲むと灰色背景で表示されます
              </p>
            </div>

            {/* プロジェクトとマイルストーン */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  プロジェクト
                </label>
                <select
                  value={projectId || ""}
                  onChange={(e) =>
                    setProjectId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">プロジェクトなし</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.icon} {project.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  マイルストーン
                </label>
                <select
                  value={milestoneId || ""}
                  onChange={(e) =>
                    setMilestoneId(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  disabled={!projectId}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">マイルストーンなし</option>
                  {milestones.map((milestone) => (
                    <option key={milestone.id} value={milestone.id}>
                      {milestone.name}
                    </option>
                  ))}
                </select>
                {!projectId && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    プロジェクトを選択してください
                  </p>
                )}
              </div>
            </div>

            {/* ステータスと優先度 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  ステータス
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="todo">未着手</option>
                  <option value="in-progress">進行中</option>
                  <option value="done">完了</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  優先度
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Priority)}
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="urgent">緊急</option>
                </select>
              </div>
            </div>

            {/* ラベルと見積もり時間 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  ラベル
                </label>
                <input
                  type="text"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: バグ修正, 機能追加"
                  value={labels}
                  onChange={(e) => setLabels(e.target.value)}
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  カンマ区切りで複数指定できます
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                  見積もり時間
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 text-base shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 2.5"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                />
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                  時間単位で入力してください
                </p>
              </div>
            </div>
          </div>

          {/* サブタスクセクション */}
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-8">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                    サブタスク
                    {subtasks.length > 0 && (
                      <span className="ml-2 text-sm font-normal text-zinc-500">
                        ({subtasks.length}件)
                      </span>
                    )}
                  </h2>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1">
                    必要に応じてサブタスクを追加できます（任意）
                  </p>
                </div>
              </div>
            </div>

            {/* 追加済みサブタスク一覧 */}
            {subtasks.length > 0 && (
              <div className="mb-4 space-y-2">
                {subtasks.map((subtask, index) => {
                  const isExpanded = expandedSubtasks.has(subtask.id);

                  return (
                    <div
                      key={subtask.id}
                      className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800"
                    >
                      {/* コンパクト表示 */}
                      <div className="flex items-center justify-between p-3">
                        <button
                          type="button"
                          onClick={() => toggleSubtaskExpanded(subtask.id)}
                          className="flex items-center gap-2 flex-1 text-left"
                        >
                          <svg
                            className={`w-4 h-4 transition-transform text-zinc-500 ${
                              isExpanded ? "rotate-90" : ""
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                          <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {subtask.title || `サブタスク ${index + 1}`}
                          </span>
                          {subtask.estimatedHours && (
                            <span className="text-xs text-zinc-500">
                              ({subtask.estimatedHours}h)
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSubtask(subtask.id)}
                          className="p-1 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                          title="削除"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>

                      {/* 展開時の詳細表示 */}
                      {isExpanded && (
                        <div className="px-3 pb-3 space-y-3 border-t border-zinc-200 dark:border-zinc-700 pt-3">
                          <div>
                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                              タイトル
                            </label>
                            <input
                              type="text"
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="サブタスクタイトル"
                              value={subtask.title}
                              onChange={(e) =>
                                updateSubtask(
                                  subtask.id,
                                  "title",
                                  e.target.value,
                                )
                              }
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                              説明
                            </label>
                            <textarea
                              className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              placeholder="説明（任意）"
                              value={subtask.description}
                              onChange={(e) =>
                                updateSubtask(
                                  subtask.id,
                                  "description",
                                  e.target.value,
                                )
                              }
                              rows={2}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                ラベル
                              </label>
                              <input
                                type="text"
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="カンマ区切り"
                                value={subtask.labels}
                                onChange={(e) =>
                                  updateSubtask(
                                    subtask.id,
                                    "labels",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                                見積もり時間
                              </label>
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="時間"
                                value={subtask.estimatedHours}
                                onChange={(e) =>
                                  updateSubtask(
                                    subtask.id,
                                    "estimatedHours",
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* サブタスク追加フォーム */}
            {isAddingSubtask ? (
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-white dark:bg-zinc-900">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-3">
                  新しいサブタスク
                </h3>
                <div className="space-y-3">
                  <div>
                    <input
                      type="text"
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="サブタスクタイトル *"
                      value={subtaskTitle}
                      onChange={(e) => setSubtaskTitle(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div>
                    <textarea
                      className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                      placeholder="説明（マークダウン対応）&#10;- [ ] チェックリスト&#10;`コード` **太字**"
                      value={subtaskDescription}
                      onChange={(e) => setSubtaskDescription(e.target.value)}
                      rows={3}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="ラベル（カンマ区切り）"
                      value={subtaskLabels}
                      onChange={(e) => setSubtaskLabels(e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="見積もり時間（h）"
                      value={subtaskEstimatedHours}
                      onChange={(e) => setSubtaskEstimatedHours(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={addSubtask}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                      disabled={!subtaskTitle.trim()}
                    >
                      追加
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddingSubtask(false);
                        setSubtaskTitle("");
                        setSubtaskDescription("");
                        setSubtaskLabels("");
                        setSubtaskEstimatedHours("");
                      }}
                      className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingSubtask(true)}
                className="w-full rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 px-4 py-3 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                + サブタスクを追加
              </button>
            )}
          </div>
        </form>

        {/* コードブロック追加ダイアログ */}
        {showCodeBlockDialog && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-zinc-900 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-y-auto shadow-xl">
              <div className="sticky top-0 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                      />
                    </svg>
                    コードブロックを追加
                  </h2>
                  <button
                    onClick={() => {
                      setShowCodeBlockDialog(false);
                      setCodeBlockContent("");
                      setCodeBlockLanguage("javascript");
                    }}
                    className="rounded-md px-3 py-1 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    閉じる
                  </button>
                </div>
              </div>

              <div className="px-6 py-4 space-y-4">
                {/* 言語選択 */}
                <div>
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                    プログラミング言語
                  </label>
                  <select
                    value={codeBlockLanguage}
                    onChange={(e) => setCodeBlockLanguage(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {PROGRAMMING_LANGUAGES.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* コード入力 */}
                <div>
                  <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                    コード
                  </label>
                  <textarea
                    value={codeBlockContent}
                    onChange={(e) => setCodeBlockContent(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                    rows={12}
                    placeholder="コードを入力してください..."
                  />
                </div>

                {/* プレビュー */}
                {codeBlockContent && (
                  <div>
                    <label className="block text-sm font-semibold text-zinc-900 dark:text-zinc-50 mb-2">
                      プレビュー
                    </label>
                    <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 overflow-hidden">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={MarkdownComponents}
                      >
                        {`\`\`\`${codeBlockLanguage}\n${codeBlockContent}\n\`\`\``}
                      </ReactMarkdown>
                    </div>
                  </div>
                )}
              </div>

              <div className="sticky bottom-0 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 px-6 py-4">
                <div className="flex gap-3 justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCodeBlockDialog(false);
                      setCodeBlockContent("");
                      setCodeBlockLanguage("javascript");
                    }}
                    className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={insertCodeBlock}
                    disabled={!codeBlockContent.trim()}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    挿入
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
