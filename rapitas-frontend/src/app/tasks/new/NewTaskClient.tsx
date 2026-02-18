"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
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
  SwatchBook,
  CheckCircle2,
  Settings2,
  FileStack,
  Sparkles,
  Loader2,
  ChevronsUp,
  ChevronUp,
  ChevronsUpDown,
  ChevronDown,
} from "lucide-react";
import type { Priority, Theme, TaskTemplate, UserSettings, Category } from "@/types";
import LabelSelector from "@/feature/tasks/components/LabelSelector";
import TaskTitleAutocomplete from "@/feature/tasks/components/TaskTitleAutocomplete";
import { getIconComponent } from "@/components/category/IconData";
import {
  CompactAccordionGroup,
  InlineFieldGroup,
  FieldItem,
} from "@/components/ui/accordion";
import ApplyTemplateDialog from "@/feature/tasks/components/dialog/ApplyTemplateDialog";
import TaskSuggestions from "@/feature/tasks/components/TaskSuggestions";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { API_BASE_URL } from "@/utils/api";
import { getTaskDetailPath } from "@/utils/tauri";
import { useAppModeStore } from "@/stores/appModeStore";

const API_BASE = API_BASE_URL;

export default function NewTaskClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();
  const appMode = useAppModeStore((state) => state.mode);

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

  // データ
  const [themes, setThemes] = useState<Theme[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // UI状態
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<TaskTemplate | null>(
    null,
  );
  // グローバル設定
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(null);

  // サブタスク
  const [subtasks, setSubtasks] = useState<
    {
      id: string;
      title: string;
      description?: string;
      estimatedHours?: number;
    }[]
  >([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      if (res.ok) {
        setCategories(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch categories:", e);
    }
  };

  useEffect(() => {
    const themeIdParam = searchParams.get("themeId");
    if (themeIdParam) {
      setThemeId(Number(themeIdParam));
    }
    fetchThemes();
    fetchCategories();
  }, [searchParams]);

  // グローバル設定の取得
  useEffect(() => {
    const fetchGlobalSettings = async () => {
      try {
        const res = await fetch(`${API_BASE}/settings`);
        if (res.ok) {
          setGlobalSettings(await res.json());
        }
      } catch (e) {
        console.error("Failed to fetch global settings:", e);
      }
    };
    fetchGlobalSettings();
  }, []);

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
        })),
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

  const handleGenerateTitle = async (fromAutoGenerate = false) => {
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

        // タイトル生成後の自動作成が有効な場合（自動生成から呼ばれた場合のみ）
        if (fromAutoGenerate && globalSettings?.autoCreateAfterTitleGeneration) {
          showToast("タスクを自動作成します...", "info");
          // 少し遅延を入れてタイトルがセットされたことを確認
          setTimeout(() => {
            handleSubmit();
          }, 500);
        }
      }
    } catch (e) {
      console.error(e);
      showToast(
        e instanceof Error ? e.message : "タイトル生成に失敗しました",
        "error",
      );
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  // タイトル自動生成のデバウンスタイマー
  const autoGenerateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // クリーンアップ
    if (autoGenerateTimerRef.current) {
      clearTimeout(autoGenerateTimerRef.current);
      autoGenerateTimerRef.current = null;
    }

    // 自動生成がONで、descriptionがあり、titleが空の場合のみ
    if (
      !globalSettings?.autoGenerateTitle ||
      !description.trim() ||
      title.trim() ||
      isGeneratingTitle
    ) {
      return;
    }

    const delaySec = globalSettings?.autoGenerateTitleDelay ?? 3;
    autoGenerateTimerRef.current = setTimeout(() => {
      handleGenerateTitle(true); // fromAutoGenerateフラグをtrueで呼び出し
    }, delaySec * 1000);

    return () => {
      if (autoGenerateTimerRef.current) {
        clearTimeout(autoGenerateTimerRef.current);
        autoGenerateTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [description, globalSettings?.autoGenerateTitle, globalSettings?.autoGenerateTitleDelay]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSubmitting || !title.trim()) return;

    const executeAfterCreate = globalSettings?.autoExecuteAfterCreate ?? false;

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
        }),
      });

      if (!res.ok) throw new Error("作成に失敗しました");
      const createdTask = await res.json();

      // サブタスク作成
      if (subtasks.length > 0) {
        const subtaskResults = await Promise.allSettled(
          subtasks
            .filter((st) => st.title.trim())
            .map(async (st) => {
              const subtaskRes = await fetch(`${API_BASE}/tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  title: st.title,
                  status: "todo",
                  parentId: createdTask.id,
                }),
              });
              if (!subtaskRes.ok) {
                const errorText = await subtaskRes.text();
                console.error(`[NewTaskClient] Failed to create subtask "${st.title}":`, errorText);
              }
              return subtaskRes;
            }),
        );

        const failedCount = subtaskResults.filter((r) => r.status === "rejected").length;
        if (failedCount > 0) {
          console.warn(`[NewTaskClient] ${failedCount} subtask(s) failed to create`);
        }
      }

      if (executeAfterCreate) {
        showToast("タスクを作成しました。実行を開始します...", "success");
        const detailPath = getTaskDetailPath(createdTask.id);
        const separator = detailPath.includes("?") ? "&" : "?";
        router.push(`${detailPath}${separator}autoExecute=true&showHeader=true`);
      } else {
        showToast("タスクを作成しました", "success");
        router.push("/");
      }
    } catch (e) {
      console.error(e);
      showToast("タスクの作成に失敗しました", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  // タスク提案を適用
  const handleApplySuggestion = (suggestion: {
    title: string;
    priority: Priority;
    estimatedHours: string;
    description: string;
    labelIds: number[];
  }) => {
    setTitle(suggestion.title);
    setPriority(suggestion.priority);
    if (suggestion.estimatedHours) {
      setEstimatedHours(suggestion.estimatedHours);
    }
    if (suggestion.description) {
      setDescription(suggestion.description);
    }
    if (suggestion.labelIds.length > 0) {
      setSelectedLabelIds(suggestion.labelIds);
    }
    showToast("提案を適用しました", "success");
  };

  const priorityOptions = [
    {
      value: "urgent" as Priority,
      label: "緊急",
      icon: <ChevronsUp className="w-3.5 h-3.5" />,
      iconColor: "text-red-500",
      bgColor: "bg-red-500",
    },
    {
      value: "high" as Priority,
      label: "高",
      icon: <ChevronUp className="w-3.5 h-3.5" />,
      iconColor: "text-orange-500",
      bgColor: "bg-orange-500",
    },
    {
      value: "medium" as Priority,
      label: "中",
      icon: <ChevronsUpDown className="w-3.5 h-3.5" />,
      iconColor: "text-blue-500",
      bgColor: "bg-blue-500",
    },
    {
      value: "low" as Priority,
      label: "低",
      icon: <ChevronDown className="w-3.5 h-3.5" />,
      iconColor: "text-zinc-400",
      bgColor: "bg-zinc-500",
    },
  ];

  return (
    <div className="h-[calc(100vh-5rem)] overflow-auto bg-background scrollbar-thin">
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
                  ? "bg-blue-100 dark:bg-blue-900/50 text-violet-700 dark:text-violet-300 border border-violet-300 dark:border-violet-700"
                  : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 hover:border-violet-400 dark:hover:border-violet-600 hover:text-violet-600 dark:hover:text-violet-400"
              }`}
            >
              <FileStack className="w-4 h-4" />
              {appliedTemplate ? appliedTemplate.name : "テンプレート"}
            </button>
            <button
              onClick={(e) => handleSubmit(e)}
              disabled={!title.trim() || isSubmitting}
              className="px-5 py-2 bg-blue-500 text-white font-semibold rounded-xl shadow-lg hover:shadow-xl hover:bg-blue-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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

      <form onSubmit={(e) => handleSubmit(e)} className="max-w-2xl mx-auto px-4 pb-8">
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
                <div className="flex items-center gap-1">
                  {priorityOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                        priority === opt.value
                          ? `${opt.bgColor} text-white shadow-md`
                          : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700"
                      }`}
                    >
                      <span
                        className={
                          priority === opt.value
                            ? "text-white"
                            : opt.iconColor
                        }
                      >
                        {opt.icon}
                      </span>
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
                    // appModeに基づいてカテゴリIDセットを構築
                    const visibleCategoryIds = new Set(
                      categories
                        .filter((cat) => {
                          if (appMode === "all") return true;
                          if (cat.mode === "both") return true;
                          return cat.mode === appMode;
                        })
                        .map((cat) => cat.id),
                    );
                    const displayThemes = themeIdParam
                      ? themes.filter((t) => t.id === Number(themeIdParam))
                      : themes.filter((t) => {
                          // appModeフィルタ: カテゴリがないテーマは常に表示
                          if (!t.categoryId) return true;
                          return visibleCategoryIds.has(t.categoryId);
                        });
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

          {/* Task Suggestions */}
          <TaskSuggestions
            themeId={themeId}
            onApply={handleApplySuggestion}
          />

          {/* Description - Collapsible */}
          <CompactAccordionGroup
            title="説明"
            icon={<FileText className="w-3.5 h-3.5" />}
            defaultExpanded={true}
            headerExtra={
              <button
                type="button"
                onClick={() => handleGenerateTitle(false)}
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
              className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-3 text-sm border-none outline-none resize-none focus:ring-2 focus:ring-blue-500/20 transition-all placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          </CompactAccordionGroup>

          {/* Advanced Options - Collapsible */}
          <CompactAccordionGroup
            title="詳細設定"
            icon={<Settings2 className="w-3.5 h-3.5" />}
            defaultExpanded={false}
          >
            <div className="space-y-4">
              {/* Due Date & Estimated Time - Inline */}
              <InlineFieldGroup>
                <FieldItem
                  label="締め切り日時"
                  icon={<Calendar className="w-3.5 h-3.5" />}
                  className="flex-1 min-w-[200px]"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:[color-scheme:dark]"
                    />
                    {dueDate && (
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 shrink-0">
                        ({new Date(dueDate).toLocaleDateString("ja-JP", { weekday: "short" })})
                      </span>
                    )}
                  </div>
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
                      className="w-16 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
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
                  className="flex-1 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm border-none outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
                />
                <button
                  type="button"
                  onClick={addSubtask}
                  disabled={!newSubtaskTitle.trim()}
                  className="px-3 py-2 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors disabled:opacity-50"
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
