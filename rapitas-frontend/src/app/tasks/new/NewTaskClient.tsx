"use client";
import { useState, useEffect, useMemo } from "react";
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
  SwatchBook,
  CheckCircle2,
  Settings2,
  FileStack,
  Sparkles,
  Loader2,
} from "lucide-react";
import type { Priority, Theme, TaskTemplate } from "@/types";
import LabelSelector from "@/feature/tasks/components/LabelSelector";
import TaskTitleAutocomplete from "@/feature/tasks/components/TaskTitleAutocomplete";
import { getIconComponent } from "@/components/category/IconData";
import {
  CompactAccordionGroup,
  InlineFieldGroup,
  FieldItem,
} from "@/components/ui/accordion";
import ApplyTemplateDialog from "@/feature/tasks/components/dialog/ApplyTemplateDialog";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { API_BASE_URL } from "@/utils/api";

const API_BASE = API_BASE_URL;

export default function NewTaskClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

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

  // データ
  const [themes, setThemes] = useState<Theme[]>([]);

  // UI状態
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<TaskTemplate | null>(
    null
  );

  // サブタスク
  const [subtasks, setSubtasks] = useState<
    { id: string; title: string; description?: string; estimatedHours?: number }[]
  >([]);
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
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  // テーマ選択時の処理
  const handleThemeSelect = (theme: Theme) => {
    setThemeId(theme.id);
  };

  // 選択中のテーマを取得
  const selectedTheme = useMemo(() => {
    return themes.find((t) => t.id === themeId) || null;
  }, [themes, themeId]);

  // テンプレート適用時の処理
  const handleApplyTemplate = (template: TaskTemplate) => {
    setAppliedTemplate(template);

    // テンプレートデータを適用
    const data = template.templateData;

    if (data.title) {
      setTitle(data.title);
    }
    if (data.description) {
      setDescription(data.description);
    }
    if (data.priority) {
      setPriority(data.priority);
    }
    if (data.estimatedHours) {
      setEstimatedHours(data.estimatedHours.toString());
    }

    // サブタスクを適用
    if (data.subtasks && Array.isArray(data.subtasks)) {
      setSubtasks(
        data.subtasks.map((st, idx) => ({
          id: `template-${idx}-${Date.now()}`,
          title: st.title,
          description: st.description,
          estimatedHours: st.estimatedHours,
        }))
      );
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

  const handleGenerateTitle = async () => {
    if (!description.trim() || isGeneratingTitle) return;

    setIsGeneratingTitle(true);
    try {
      const res = await fetch(`${API_BASE}/developer-mode/generate-title`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "タイトル生成に失敗しました");
      }

      const data = await res.json();
      if (data.title) {
        setTitle(data.title);
        showToast("タイトルを自動生成しました", "success");
      }
    } catch (e) {
      console.error(e);
      showToast(
        e instanceof Error ? e.message : "タイトル生成に失敗しました",
        "error"
      );
    } finally {
      setIsGeneratingTitle(false);
    }
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

      showToast("タスクを作成しました", "success");
      router.push("/");
    } catch (e) {
      console.error(e);
      showToast("タスクの作成に失敗しました", "error");
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
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-linear-to-br from-slate-50 via-white to-blue-50 dark:from-zinc-950 dark:via-zinc-900 dark:to-blue-950/20 scrollbar-thin">
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTemplateDialog(true)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                appliedTemplate
                  ? "bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700"
                  : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-violet-400 dark:hover:border-violet-600 hover:text-violet-600 dark:hover:text-violet-400"
              }`}
            >
              <FileStack className="w-4 h-4" />
              {appliedTemplate ? appliedTemplate.name : "テンプレート"}
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
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl mx-auto px-4 pb-8">
        {/* Main Card */}
        <div className="bg-white dark:bg-indigo-dark-900 rounded-2xl shadow-xl shadow-zinc-200/50 dark:shadow-none border border-zinc-200/50 dark:border-zinc-800 overflow-hidden">
          {/* Title Section */}
          <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
            <TaskTitleAutocomplete
              value={title}
              onChange={setTitle}
              placeholder="タスクのタイトル"
              autoFocus
              themeId={themeId}
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
            defaultExpanded={true}
            headerExtra={
              <button
                type="button"
                onClick={handleGenerateTitle}
                disabled={!description.trim() || isGeneratingTitle}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-900 disabled:opacity-40 disabled:cursor-not-allowed"
                title="説明からタイトルを自動生成"
              >
                {isGeneratingTitle ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                タイトル生成
              </button>
            }
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

      {/* Template Dialog */}
      <ApplyTemplateDialog
        isOpen={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        selectedTheme={selectedTheme}
        onApply={handleApplyTemplate}
      />
    </div>
  );
}
