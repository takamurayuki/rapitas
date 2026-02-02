"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task, ExamGoal } from "@/types";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Target,
  CheckCircle2,
  Circle,
  Plus,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { getTaskDetailPath } from "@/utils/tauri";
import { API_BASE_URL } from "@/utils/api";

const API_BASE = API_BASE_URL;

type CalendarEvent = {
  id: number;
  title: string;
  date: string;
  type: "task" | "exam";
  status?: string;
  color?: string;
};

export default function CalendarPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchEvents();
  }, [currentDate]);

  const fetchEvents = async () => {
    try {
      const [tasksRes, examsRes] = await Promise.all([
        fetch(`${API_BASE}/tasks`),
        fetch(`${API_BASE}/exam-goals`),
      ]);

      const tasks: Task[] = tasksRes.ok ? await tasksRes.json() : [];
      const exams: ExamGoal[] = examsRes.ok ? await examsRes.json() : [];

      const taskEvents: CalendarEvent[] = tasks
        .filter((t) => t.dueDate)
        .map((t) => ({
          id: t.id,
          title: t.title,
          date: t.dueDate!.split("T")[0],
          type: "task" as const,
          status: t.status,
          color: t.theme?.color,
        }));

      const examEvents: CalendarEvent[] = exams.map((e) => ({
        id: e.id,
        title: e.name,
        date: e.examDate.split("T")[0],
        type: "exam" as const,
        color: e.color,
      }));

      setEvents([...taskEvents, ...examEvents]);
    } catch (e) {
      console.error("Failed to fetch events:", e);
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: (number | null)[] = [];

    // 前月の空白日
    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }

    // 当月の日
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    return days;
  };

  const getEventsForDate = (day: number) => {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    const dateStr = `${year}-${month}-${dayStr}`;
    return events.filter((e) => e.date === dateStr);
  };

  const formatDateStr = (day: number) => {
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, "0");
    const dayStr = String(day).padStart(2, "0");
    return `${year}-${month}-${dayStr}`;
  };

  const prevMonth = () => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1),
    );
  };

  const nextMonth = () => {
    setCurrentDate(
      new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1),
    );
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentDate.getMonth() === today.getMonth() &&
      currentDate.getFullYear() === today.getFullYear()
    );
  };

  const openCreateModal = () => {
    if (selectedDate) {
      setShowCreateModal(true);
    }
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim() || !selectedDate) return;

    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTaskTitle,
          dueDate: new Date(selectedDate).toISOString(),
          status: "todo",
        }),
      });

      if (res.ok) {
        showToast("タスクを作成しました", "success");
        setNewTaskTitle("");
        setShowCreateModal(false);
        fetchEvents();
      } else {
        showToast("タスクの作成に失敗しました", "error");
      }
    } catch (e) {
      console.error("Failed to create task:", e);
      showToast("エラーが発生しました", "error");
    } finally {
      setCreating(false);
    }
  };

  const days = getDaysInMonth(currentDate);
  const weekDays = ["日", "月", "火", "水", "木", "金", "土"];
  const selectedDateEvents = selectedDate
    ? events.filter((e) => e.date === selectedDate)
    : [];

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-96 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <CalendarIcon className="w-8 h-8 text-indigo-500" />
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            カレンダー
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            締め切りと試験日を一覧表示
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* カレンダー */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <button
                onClick={prevMonth}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50 min-w-[140px] text-center">
                {currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月
              </h2>
              <button
                onClick={nextMonth}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={goToToday}
              className="px-3 py-1.5 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50"
            >
              今日
            </button>
          </div>

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map((day, index) => (
              <div
                key={day}
                className={`text-center text-sm font-medium py-2 ${
                  index === 0
                    ? "text-red-500"
                    : index === 6
                      ? "text-blue-500"
                      : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* 日付グリッド */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day, index) => {
              if (day === null) {
                return <div key={`empty-${index}`} className="aspect-square" />;
              }

              const dayEvents = getEventsForDate(day);
              const dateStr = formatDateStr(day);
              const isSelected = selectedDate === dateStr;
              const today = isToday(day);
              const dayOfWeek = index % 7;

              return (
                <button
                  key={day}
                  onClick={() => setSelectedDate(dateStr)}
                  className={`aspect-square p-1 rounded-lg transition-all ${
                    isSelected
                      ? "bg-indigo-100 dark:bg-indigo-900/40 ring-2 ring-indigo-500"
                      : "hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  }`}
                >
                  <div
                    className={`text-sm font-medium mb-1 ${
                      today
                        ? "w-6 h-6 bg-indigo-500 text-white rounded-full flex items-center justify-center mx-auto"
                        : dayOfWeek === 0
                          ? "text-red-500"
                          : dayOfWeek === 6
                            ? "text-blue-500"
                            : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {day}
                  </div>
                  {dayEvents.length > 0 && (
                    <div className="flex justify-center gap-0.5">
                      {dayEvents.slice(0, 3).map((event) => (
                        <div
                          key={`${event.type}-${event.id}`}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              event.type === "exam"
                                ? event.color || "#10B981"
                                : event.color || "#3B82F6",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* 凡例 */}
          <div className="flex items-center gap-4 mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700">
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              タスク締め切り
            </div>
            <div className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              試験日
            </div>
          </div>
        </div>

        {/* 選択日の詳細 */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-zinc-800 dark:text-zinc-200">
              {selectedDate
                ? new Date(selectedDate).toLocaleDateString("ja-JP", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    weekday: "short",
                  })
                : "日付を選択"}
            </h3>
            {selectedDate && (
              <button
                onClick={openCreateModal}
                className="flex items-center gap-1 px-2 py-1 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                タスク追加
              </button>
            )}
          </div>

          {selectedDate ? (
            selectedDateEvents.length > 0 ? (
              <div className="space-y-3">
                {selectedDateEvents.map((event) => (
                  <button
                    key={`${event.type}-${event.id}`}
                    onClick={() => {
                      if (event.type === "task") {
                        router.push(getTaskDetailPath(event.id));
                      }
                    }}
                    className="w-full flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-left"
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${event.color || "#3B82F6"}20`,
                        color: event.color || "#3B82F6",
                      }}
                    >
                      {event.type === "exam" ? (
                        <Target className="w-4 h-4" />
                      ) : event.status === "done" ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-zinc-800 dark:text-zinc-200 text-sm">
                        {event.title}
                      </p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {event.type === "exam" ? "試験" : "タスク"}
                        {event.status === "done" && " ・ 完了"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-3">
                  この日の予定はありません
                </p>
                <button
                  onClick={openCreateModal}
                  className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  + タスクを追加
                </button>
              </div>
            )
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center py-8">
              カレンダーから日付を選択してください
            </p>
          )}
        </div>
      </div>

      {/* タスク作成モーダル */}
      {showCreateModal && selectedDate && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                タスクを追加
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
              締め切り:{" "}
              {new Date(selectedDate).toLocaleDateString("ja-JP", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>

            <form onSubmit={createTask}>
              <input
                type="text"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                placeholder="タスク名を入力..."
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded-lg text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
              />

              <div className="flex gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 px-4 py-2.5 bg-zinc-100 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={!newTaskTitle.trim() || creating}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? "作成中..." : "作成"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
