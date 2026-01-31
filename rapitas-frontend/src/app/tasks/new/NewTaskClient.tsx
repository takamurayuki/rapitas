"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Clock,
  Tag,
  Layers,
  Flag,
  FileText,
  Plus,
  Trash2,
  Calendar,
  BookOpen,
  Bot,
  SwatchBook,
  CheckCircle2,
  Settings2,
} from "lucide-react";
import type { Priority, Theme, UserSettings } from "@/types";
import LabelSelector from "@/feature/tasks/components/LabelSelector";
import { getIconComponent } from "@/components/category/IconData";
import {
  CompactAccordionGroup,
  InlineFieldGroup,
  FieldItem,
} from "@/components/ui/accordion";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3001";

export default function NewTaskClient() {
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

  // タスクの設定
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [isAiTaskAnalysis, setIsAiTaskAnalysis] = useState(false);

  // データ
  const [themes, setThemes] = useState<Theme[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  // UI状態
  const [isSubmitting, setIsSubmitting] = useState(false);

  // サブタスク
  const [subtasks, setSubtasks] = useState<{ id: string; title: string }[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  useEffect(() => {
    const themeIdParam = searchParams.get("themeId");
    if (themeIdParam) {
      setThemeId(Number(themeIdParam));
    }
    fetchThemes();
    fetchSettings();
  }, [searchParams]);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
        // 設定からデフォルト値を適用
        if (data.developerModeDefault) {
          setIsDeveloperMode(true);
        }
        if (data.aiTaskAnalysisDefault) {
          setIsAiTaskAnalysis(true);
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

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
          (t: Theme) => t.id === Number(themeIdParam),
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
          isAiTaskAnalysis: isAiTaskAnalysis || undefined,
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

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 pb-8">
        {/* Main Card */}
        <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
          {/* Title Section */}
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="タスクのタイトル"
              className="w-full text-xl font-semibold bg-transparent border-none outline-none placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
              autoFocus
            />
          </div>

          {/* Priority & Theme - Compact inline */}
          <div className="px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
            <InlineFieldGroup>
              {/* Priority */}
              <FieldItem
                label="優先度"
                icon={<Flag className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                <div className="flex gap-1">
                  {priorityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        priority === opt.value
                          ? `${opt.bg} ${opt.color} ring-1 ring-current ring-opacity-30`
                          : "bg-zinc-50 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FieldItem>

              {/* Theme */}
              <FieldItem
                label="テーマ"
                icon={<Layers className="w-3.5 h-3.5" />}
                className="flex-1"
              >
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const themeIdParam = searchParams.get("themeId");
                    const displayThemes = themeIdParam
                      ? themes.filter((t) => t.id === Number(themeIdParam))
                      : themes;
                    return displayThemes.map((theme) => {
                      const ThemeIcon =
                        getIconComponent(theme.icon || "") || SwatchBook;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() => handleThemeSelect(theme)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
                            themeId === theme.id
                              ? "ring-1 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900"
                              : "opacity-60 hover:opacity-100"
                          }`}
                          style={
                            {
                              backgroundColor:
                                themeId === theme.id
                                  ? theme.color
                                  : `${theme.color}20`,
                              color:
                                themeId === theme.id ? "#fff" : theme.color,
                              ["--tw-ring-color" as keyof React.CSSProperties]:
                                theme.color,
                            } as React.CSSProperties
                          }
                        >
                          <ThemeIcon className="w-2.5 h-2.5" />
                          {theme.name}
                        </button>
                      );
                    });
                  })()}
                </div>
              </FieldItem>
            </InlineFieldGroup>
          </div>

          {/* Description - Collapsible */}
          <CompactAccordionGroup
            title="説明"
            icon={<FileText className="w-3.5 h-3.5" />}
            defaultExpanded={false}
          >
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="タスクの詳細を記入（マークダウン対応）"
              rows={3}
              className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-violet-500/20 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </CompactAccordionGroup>

          {/* Advanced Options - Collapsible */}
          <CompactAccordionGroup
            title="詳細設定"
            icon={<Settings2 className="w-3.5 h-3.5" />}
            defaultExpanded={false}
          >
            <div className="space-y-4">
              {/* Due Date & Subject & Estimated Time - Inline */}
              <InlineFieldGroup>
                <FieldItem
                  label="締め切り日"
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  className="flex-1 min-w-[140px]"
                >
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </FieldItem>
                <FieldItem
                  label="科目"
                  icon={<BookOpen className="w-3.5 h-3.5" />}
                  className="flex-1 min-w-[140px]"
                >
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="例: 英語、数学"
                    className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                  />
                </FieldItem>
                <FieldItem
                  label="見積もり時間"
                  icon={<Clock className="w-3.5 h-3.5" />}
                  className="flex-1 min-w-[100px]"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      value={estimatedHours}
                      onChange={(e) => setEstimatedHours(e.target.value)}
                      placeholder="0"
                      className="w-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                    />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      時間
                    </span>
                  </div>
                </FieldItem>
              </InlineFieldGroup>

              {/* Labels */}
              <FieldItem
                label="ラベル"
                icon={<Tag className="w-3.5 h-3.5" />}
                fullWidth
              >
                <LabelSelector
                  selectedLabelIds={selectedLabelIds}
                  onChange={setSelectedLabelIds}
                />
              </FieldItem>
            </div>
          </CompactAccordionGroup>

          {/* AI Settings - Collapsible */}
          <CompactAccordionGroup
            title="AI設定"
            icon={<Bot className="w-3.5 h-3.5" />}
            defaultExpanded={false}
          >
            <div className="p-3 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 rounded-xl space-y-3">
              {/* 開発者モード */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    開発者モード
                  </p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    開発プロジェクト向けの機能を有効化
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsDeveloperMode(!isDeveloperMode)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    isDeveloperMode
                      ? "bg-violet-500"
                      : "bg-zinc-300 dark:bg-zinc-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      isDeveloperMode ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
              {/* AIタスク分析 */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                    AIタスク分析
                  </p>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                    AIがサブタスクを自動提案
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAiTaskAnalysis(!isAiTaskAnalysis)}
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    isAiTaskAnalysis
                      ? "bg-violet-500"
                      : "bg-zinc-300 dark:bg-zinc-600"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      isAiTaskAnalysis ? "translate-x-5" : ""
                    }`}
                  />
                </button>
              </div>
            </div>
          </CompactAccordionGroup>

          {/* Subtasks Section - Collapsible */}
          <CompactAccordionGroup
            title="サブタスク"
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            badge={
              subtasks.length > 0 ? (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-full">
                  {subtasks.length}
                </span>
              ) : undefined
            }
            defaultExpanded={false}
            className="border-b-0"
          >
            <div className="space-y-2">
              {/* Subtask List */}
              {subtasks.map((st) => (
                <div
                  key={st.id}
                  className="flex items-center gap-2 p-2 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg group"
                >
                  <div className="w-4 h-4 rounded-full border-2 border-zinc-300 dark:border-zinc-600" />
                  <span className="flex-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {st.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeSubtask(st.id)}
                    className="p-1 text-zinc-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
                  className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-violet-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={addSubtask}
                  disabled={!newSubtaskTitle.trim()}
                  className="px-3 py-2 bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 rounded-lg hover:bg-violet-200 dark:hover:bg-violet-900 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </CompactAccordionGroup>
        </div>
      </form>
    </div>
  );
}
