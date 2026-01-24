"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  ChevronDown,
  Clock,
  Tag,
  Layers,
  Flag,
  FileText,
  Plus,
  X,
  Check,
  Trash2,
  Calendar,
  BookOpen,
  Code2,
  Bot,
} from "lucide-react";
import type { Priority, Theme, Label } from "@/types";
import LabelSelector from "@/feature/tasks/components/label-selector";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function NewTaskPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // 基本フィールド
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [themeId, setThemeId] = useState<number | null>(null);

  // オプションフィールド
  const [labels, setLabels] = useState("");
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [estimatedHours, setEstimatedHours] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [subject, setSubject] = useState("");

  // 開発者モード
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);

  // データ
  const [themes, setThemes] = useState<Theme[]>([]);

  // UI状態
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSubtasks, setShowSubtasks] = useState(false);

  // サブタスク
  const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  useEffect(() => {
    const themeIdParam = searchParams.get("themeId");
    if (themeIdParam) {
      setThemeId(Number(themeIdParam));
    }
    fetchThemes();
  }, [searchParams]);

  const fetchThemes = async () => {
    try {
      const res = await fetch(`${API_BASE}/themes`);
      const data = await res.json();
      setThemes(data);
      const themeIdParam = searchParams.get("themeId");
      if (!themeIdParam) {
        const defaultTheme = data.find((t: Theme) => t.isDefault);
        if (defaultTheme) {
          setThemeId(defaultTheme.id);
          // 開発テーマの場合は自動で開発者モードを有効化
          if (defaultTheme.isDevelopment) {
            setIsDeveloperMode(true);
          }
        }
      } else {
        // URLパラメータで指定されたテーマの場合
        const selectedTheme = data.find(
          (t: Theme) => t.id === Number(themeIdParam)
        );
        if (selectedTheme?.isDevelopment) {
          setIsDeveloperMode(true);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // テーマ選択時の処理
  const handleThemeSelect = (theme: Theme) => {
    setThemeId(theme.id);
    // 開発テーマの場合は自動で開発者モードを有効化
    if (theme.isDevelopment) {
      setIsDeveloperMode(true);
    }
  };

  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    setSubtasks([
      ...subtasks,
      { id: Date.now().toString(), title: newSubtaskTitle },
    ]);
    setNewSubtaskTitle("");
  };

  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !title.trim()) return;

    setIsSubmitting(true);
    try {
      const labelArray = labels
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          status: "todo",
          priority,
          themeId: themeId || undefined,
          labels: labelArray.length > 0 ? labelArray : undefined,
          labelIds: selectedLabelIds.length > 0 ? selectedLabelIds : undefined,
          estimatedHours: estimatedHours
            ? parseFloat(estimatedHours)
            : undefined,
          dueDate: dueDate || undefined,
          subject: subject || undefined,
          isDeveloperMode: isDeveloperMode || undefined,
        }),
      });

      if (!res.ok) throw new Error("作成に失敗しました");
      const createdTask = await res.json();

      // サブタスク作成
      if (subtasks.length > 0) {
        await Promise.all(
          subtasks
            .filter((st) => st.title.trim())
            .map((st) =>
              fetch(`${API_BASE}/tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: st.title,
                  status: "todo",
                  parentId: createdTask.id,
                }),
              }),
            ),
        );
      }

      router.push("/");
    } catch (e) {
      console.error(e);
      alert("タスクの作成に失敗しました");
    } finally {
      setIsSubmitting(false);
    }
  };

  const priorityOptions: {
    value: Priority;
    label: string;
    color: string;
    bg: string;
  }[] = [
    {
      value: "low",
      label: "低",
      color: "text-slate-600 dark:text-slate-400",
      bg: "bg-slate-100 dark:bg-slate-800",
    },
    {
      value: "medium",
      label: "中",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900/50",
    },
    {
      value: "high",
      label: "高",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-100 dark:bg-amber-900/50",
    },
    {
      value: "urgent",
      label: "緊急",
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-100 dark:bg-rose-900/50",
    },
  ];

  return (
    <div className="min-h-screen bg-linear-to-br from-slate-50 via-white to-blue-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-blue-950/20">
      {/* Header */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium">戻る</span>
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || isSubmitting}
            className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSubmitting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            作成
          </button>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4">
        {/* Main Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
          {/* Title Section */}
          <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="タスクのタイトル"
              className="w-full text-xl font-semibold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
              autoFocus
            />
          </div>

          {/* Description */}
          <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                説明
              </span>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="タスクの詳細を記入（マークダウン対応）"
              rows={4}
              className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </div>

          {/* Priority & Theme */}
          <div className="p-6 border-b border-zinc-100 dark:border-zinc-800">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Priority */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Flag className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    優先度
                  </span>
                </div>
                <div className="flex gap-2">
                  {priorityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        priority === opt.value
                          ? `${opt.bg} ${opt.color} ring-2 ring-current ring-opacity-30`
                          : "bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Theme */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    テーマ
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {themes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      onClick={() => handleThemeSelect(theme)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                        themeId === theme.id
                          ? "ring-2 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900 scale-105"
                          : "opacity-60 hover:opacity-100"
                      }`}
                      style={{
                        backgroundColor:
                          themeId === theme.id
                            ? theme.color
                            : `${theme.color}20`,
                        color: themeId === theme.id ? "#fff" : theme.color,
                        ["--tw-ring-color" as any]: theme.color,
                      }}
                    >
                      {theme.isDevelopment && <Code2 className="w-3 h-3" />}
                      {theme.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 開発者モード */}
          {(isDeveloperMode ||
            themes.find((t) => t.id === themeId)?.isDevelopment) && (
            <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
                    <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <h3 className="font-medium text-zinc-900 dark:text-zinc-50">
                      開発者モード
                    </h3>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400">
                      AIがタスクを分析し、サブタスクを自動提案します
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeveloperMode(!isDeveloperMode)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${
                    isDeveloperMode
                      ? "bg-violet-500"
                      : "bg-zinc-300 dark:bg-zinc-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                      isDeveloperMode ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full p-4 flex items-center justify-between text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
          >
            <span>詳細オプション</span>
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {/* Advanced Options Content */}
          {showAdvanced && (
            <div className="p-6 pt-0 space-y-6 animate-in slide-in-from-top-2 duration-200">
              {/* Due Date & Subject */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Due Date */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      締め切り日
                    </span>
                  </div>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </div>

                {/* Subject */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-4 h-4 text-zinc-400" />
                    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                      科目
                    </span>
                  </div>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="例: 英語、数学、プログラミング"
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </div>
              </div>

              {/* Labels */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Tag className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    ラベル
                  </span>
                </div>
                <LabelSelector
                  selectedLabelIds={selectedLabelIds}
                  onChange={setSelectedLabelIds}
                />
              </div>

              {/* Estimated Time */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4 text-zinc-400" />
                  <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                    見積もり時間
                  </span>
                </div>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  placeholder="時間"
                  className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
              </div>
            </div>
          )}

          {/* Subtasks Section */}
          <div className="border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setShowSubtasks(!showSubtasks)}
              className="w-full p-4 flex items-center justify-between text-sm font-medium text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span>サブタスク</span>
                {subtasks.length > 0 && (
                  <span className="px-2 py-0.5 bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 rounded-full text-xs">
                    {subtasks.length}
                  </span>
                )}
              </div>
              <ChevronDown
                className={`w-4 h-4 transition-transform ${showSubtasks ? "rotate-180" : ""}`}
              />
            </button>

            {showSubtasks && (
              <div className="p-6 pt-0 space-y-3 animate-in slide-in-from-top-2 duration-200">
                {/* Subtask List */}
                {subtasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl group"
                  >
                    <div className="w-5 h-5 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
                    <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                      {st.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeSubtask(st.id)}
                      className="p-1 text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {/* Add Subtask Input */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addSubtask();
                      }
                    }}
                    placeholder="サブタスクを追加..."
                    className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                  <button
                    type="button"
                    onClick={addSubtask}
                    disabled={!newSubtaskTitle.trim()}
                    className="px-4 py-2.5 bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 rounded-xl hover:bg-violet-200 dark:hover:bg-violet-900 transition-colors disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Keyboard Hint */}
        <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          <kbd className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded font-mono">
            ⌘
          </kbd>{" "}
          +{" "}
          <kbd className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded font-mono">
            Enter
          </kbd>{" "}
          で作成
        </p>
      </form>
    </div>
  );
}
