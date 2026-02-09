"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Task, ExamGoal, ScheduleEvent, ScheduleEventInput } from "@/types";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Target,
  CheckCircle2,
  Circle,
  Plus,
  X,
  Clock,
  Bell,
  Trash2,
} from "lucide-react";
import { useToast } from "@/components/ui/toast/ToastContainer";
import { getTaskDetailPath } from "@/utils/tauri";
import { API_BASE_URL } from "@/utils/api";
import ScheduleEventDialog from "@/feature/calendar/components/ScheduleEventDialog";
import { getHolidaysForMonth, type Holiday } from "@/utils/holidays";

const API_BASE = API_BASE_URL;

type CalendarEvent = {
  id: number;
  title: string;
  date: string;
  endDate?: string;
  type: "task" | "exam" | "schedule";
  status?: string;
  color?: string;
  time?: string;
  endTime?: string;
  reminderMinutes?: number | null;
  description?: string | null;
};

export default function CalendarPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const [tasksRes, examsRes, schedulesRes] = await Promise.all([
        fetch(`${API_BASE}/tasks`),
        fetch(`${API_BASE}/exam-goals`),
        fetch(`${API_BASE}/schedules`),
      ]);

      const tasks: Task[] = tasksRes.ok ? await tasksRes.json() : [];
      const exams: ExamGoal[] = examsRes.ok ? await examsRes.json() : [];
      const schedules: ScheduleEvent[] = schedulesRes.ok
        ? await schedulesRes.json()
        : [];

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

      const scheduleEvents: CalendarEvent[] = schedules.map((s) => {
        const startDateObj = new Date(s.startAt);
        const timeStr = s.isAllDay
          ? undefined
          : startDateObj.toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
            });
        const endTimeStr = s.endAt && !s.isAllDay
          ? new Date(s.endAt).toLocaleTimeString("ja-JP", {
              hour: "2-digit",
              minute: "2-digit",
            })
          : undefined;
        const startDateStr = s.startAt.split("T")[0];
        const endDateStr = s.endAt ? s.endAt.split("T")[0] : undefined;
        return {
          id: s.id,
          title: s.title,
          date: startDateStr,
          endDate: endDateStr && endDateStr > startDateStr ? endDateStr : undefined,
          type: "schedule" as const,
          color: s.color,
          time: timeStr,
          endTime: endTimeStr,
          reminderMinutes: s.reminderMinutes,
          description: s.description,
        };
      });

      setEvents([...taskEvents, ...examEvents, ...scheduleEvents]);
    } catch (e) {
      console.error("Failed to fetch events:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, currentDate]);

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();

    const days: (number | null)[] = [];

    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }

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
    return events.filter((e) => {
      if (e.date === dateStr) return true;
      // 複数日スケジュールの場合、開始日〜終了日の範囲内かチェック
      if (e.endDate && e.date <= dateStr && e.endDate >= dateStr) return true;
      return false;
    });
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
    const today = new Date();
    setCurrentDate(today);
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    setSelectedDate(`${year}-${month}-${day}`);
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

  const createScheduleEvent = async (data: ScheduleEventInput) => {
    try {
      const res = await fetch(`${API_BASE}/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        showToast("スケジュールを追加しました", "success");
        setShowScheduleModal(false);
        fetchEvents();
      } else {
        showToast("スケジュールの追加に失敗しました", "error");
      }
    } catch (e) {
      console.error("Failed to create schedule:", e);
      showToast("エラーが発生しました", "error");
    }
  };

  const deleteScheduleEvent = async (eventId: number) => {
    try {
      const res = await fetch(`${API_BASE}/schedules/${eventId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        showToast("スケジュールを削除しました", "success");
        fetchEvents();
      } else {
        showToast("スケジュールの削除に失敗しました", "error");
      }
    } catch (e) {
      console.error("Failed to delete schedule:", e);
      showToast("エラーが発生しました", "error");
    }
  };

  const getReminderLabel = (minutes: number) => {
    if (minutes < 60) return `${minutes}分前`;
    if (minutes < 1440) return `${minutes / 60}時間前`;
    return `${minutes / 1440}日前`;
  };

  const days = getDaysInMonth(currentDate);
  const weekDays = ["日", "月", "火", "水", "木", "金", "土"];

  // 祝日データ（月ごとにメモ化）
  const holidays = useMemo(() => {
    return getHolidaysForMonth(currentDate.getFullYear(), currentDate.getMonth());
  }, [currentDate]);

  const holidayMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of holidays) {
      map.set(h.date, h.name);
    }
    return map;
  }, [holidays]);

  // 複数日イベントのバー表示用データを計算
  const getMultiDayBars = () => {
    const multiDayEvents = events.filter((e) => e.endDate && e.type === "schedule");
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const startingWeekday = firstDayOfMonth.getDay();

    type BarSegment = {
      event: CalendarEvent;
      gridCol: number; // 0-6 (グリッド内の列)
      gridRow: number; // 週の行
      span: number; // 何セル分の幅
      isStart: boolean;
      isEnd: boolean;
      lane: number; // バーの縦位置（0, 1, 2...）
    };

    const bars: BarSegment[] = [];
    // 各セルのレーン使用状況を追跡
    const cellLanes: Map<string, Set<number>> = new Map();

    const getGridPosition = (day: number) => {
      const index = startingWeekday + day - 1;
      return { col: index % 7, row: Math.floor(index / 7) };
    };

    for (const event of multiDayEvents) {
      const eventStart = new Date(event.date + "T00:00:00");
      const eventEnd = new Date(event.endDate! + "T00:00:00");

      // 表示月の範囲にクリップ
      const visibleStart = eventStart < firstDayOfMonth ? firstDayOfMonth : eventStart;
      const visibleEnd = eventEnd > lastDayOfMonth ? lastDayOfMonth : eventEnd;

      if (visibleStart > lastDayOfMonth || visibleEnd < firstDayOfMonth) continue;

      const startDay = visibleStart.getDate();
      const endDay = visibleEnd.getDate();

      // 週ごとにバーを分割
      let currentDay = startDay;
      while (currentDay <= endDay) {
        const pos = getGridPosition(currentDay);
        const remainInWeek = 7 - pos.col;
        const remainInEvent = endDay - currentDay + 1;
        const span = Math.min(remainInWeek, remainInEvent);

        // この区間で空きレーンを探す
        let lane = 0;
        let laneFound = false;
        while (!laneFound) {
          laneFound = true;
          for (let d = currentDay; d < currentDay + span; d++) {
            const key = `${pos.row}-${getGridPosition(d).col}`;
            const used = cellLanes.get(key);
            if (used && used.has(lane)) {
              laneFound = false;
              lane++;
              break;
            }
          }
        }

        // レーンを予約
        for (let d = currentDay; d < currentDay + span; d++) {
          const key = `${pos.row}-${getGridPosition(d).col}`;
          if (!cellLanes.has(key)) cellLanes.set(key, new Set());
          cellLanes.get(key)!.add(lane);
        }

        const isEventStart = eventStart.getMonth() === month && currentDay === eventStart.getDate();
        const isEventEnd = eventEnd.getMonth() === month && currentDay + span - 1 === eventEnd.getDate();

        bars.push({
          event,
          gridCol: pos.col,
          gridRow: pos.row,
          span,
          isStart: isEventStart,
          isEnd: isEventEnd,
          lane,
        });

        currentDay += span;
      }
    }

    return bars;
  };

  const multiDayBars = getMultiDayBars();
  const selectedDateEvents = selectedDate
    ? events.filter((e) => {
        if (e.date === selectedDate) return true;
        if (e.endDate && e.date <= selectedDate && e.endDate >= selectedDate) return true;
        return false;
      })
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
            スケジュール・締め切り・試験日を一覧表示
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

          {/* 日付グリッド（週ごとに行を分割） */}
          {(() => {
            const weeks: (number | null)[][] = [];
            for (let i = 0; i < days.length; i += 7) {
              weeks.push(days.slice(i, i + 7));
            }
            // 7列に足りない最終週をnullで埋める
            const lastWeek = weeks[weeks.length - 1];
            while (lastWeek.length < 7) {
              lastWeek.push(null);
            }

            // 各セルに表示するイベント数の上限
            const MAX_VISIBLE_EVENTS = 3;

            return weeks.map((week, weekIndex) => {
              // この週のバー
              const weekBars = multiDayBars.filter((b) => b.gridRow === weekIndex);
              // この週の最大レーン数
              const maxLaneInWeek = weekBars.length > 0 ? Math.max(...weekBars.map((b) => b.lane)) + 1 : 0;
              const barAreaHeight = maxLaneInWeek * 18;

              return (
                <div key={`week-${weekIndex}`} className="relative">
                  <div className="grid grid-cols-7">
                    {week.map((day, colIndex) => {
                      if (day === null) {
                        return (
                          <div
                            key={`empty-${weekIndex}-${colIndex}`}
                            className="border border-zinc-100 dark:border-zinc-700/50 flex flex-col bg-zinc-100/70 dark:bg-zinc-900/50"
                          >
                            {/* 空セルの日付ヘッダー相当 */}
                            <div className="w-full px-1 py-0.5 bg-zinc-200/50 dark:bg-zinc-800/90">
                              <div className="w-[20px] h-[20px]" />
                            </div>
                            <div className="w-full border-b border-zinc-200/50 dark:border-zinc-700/30" />
                            <div className="w-full aspect-square bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(0,0,0,0.03)_4px,rgba(0,0,0,0.03)_5px)] dark:bg-[repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(255,255,255,0.02)_4px,rgba(255,255,255,0.02)_5px)]" />
                          </div>
                        );
                      }

                      const dayEvents = getEventsForDate(day);
                      const singleDayEvents = dayEvents.filter(
                        (e) => !(e.endDate && e.type === "schedule")
                      );
                      const dateStr = formatDateStr(day);
                      const isSelected = selectedDate === dateStr;
                      const today = isToday(day);
                      const dayOfWeek = colIndex;
                      const holidayName = holidayMap.get(dateStr);
                      const isHoliday = !!holidayName;
                      const hiddenCount = singleDayEvents.length - MAX_VISIBLE_EVENTS;

                      return (
                        <button
                          key={day}
                          onClick={() => setSelectedDate(dateStr)}
                          onDoubleClick={() => {
                            setSelectedDate(dateStr);
                            setShowScheduleModal(true);
                          }}
                          className={`p-0 transition-all border border-zinc-200 dark:border-zinc-700/50 text-left flex flex-col relative ${
                            isSelected
                              ? "outline-2 outline-indigo-500 -outline-offset-2 z-10"
                              : "hover:bg-zinc-50 dark:hover:bg-zinc-700/30"
                          }`}
                        >
                          {/* 日付ヘッダー（背景色付き・左寄せ） */}
                          <div className={`w-full flex items-center px-1 py-0.5 gap-0.5 min-w-0 ${
                            isSelected
                              ? "bg-indigo-50 dark:bg-indigo-900/30"
                              : isHoliday
                                ? "bg-red-50 dark:bg-red-900/15"
                                : "bg-zinc-50 dark:bg-zinc-800/80"
                          }`}>
                            <div className={`flex items-center justify-center w-[20px] h-[20px] rounded-sm shrink-0 ${
                              today ? "bg-indigo-500" : ""
                            }`}>
                              <span
                                className={`text-xs font-semibold leading-none ${
                                  today
                                    ? "text-white"
                                    : dayOfWeek === 0 || isHoliday
                                      ? "text-red-500"
                                      : dayOfWeek === 6
                                        ? "text-blue-500"
                                        : "text-zinc-700 dark:text-zinc-300"
                                }`}
                              >
                                {day}
                              </span>
                            </div>
                          </div>
                          {/* 区切り線（セル全幅） */}
                          <div className="w-full border-b border-zinc-200 dark:border-zinc-600/60" />
                          {/* 区切り線下のコンテンツ領域（正方形を維持） */}
                          <div className="w-full aspect-square relative">
                            {/* バーのスペーサー */}
                            {barAreaHeight > 0 && (
                              <div style={{ height: barAreaHeight }} />
                            )}
                            {/* イベント内容表示エリア */}
                            <div className="px-0.5 py-0.5 space-y-0.5 overflow-hidden">
                              {singleDayEvents.slice(0, MAX_VISIBLE_EVENTS).map((event) => {
                                const bgColor =
                                  event.type === "exam"
                                    ? event.color || "#10B981"
                                    : event.type === "schedule"
                                      ? event.color || "#6366F1"
                                      : event.color || "#3B82F6";
                                return (
                                  <div
                                    key={`${event.type}-${event.id}`}
                                    className="flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight font-medium truncate"
                                    style={{
                                      backgroundColor: `${bgColor}18`,
                                      color: bgColor,
                                      borderLeft: `2px solid ${bgColor}`,
                                    }}
                                  >
                                    {event.time && (
                                      <span className="shrink-0 opacity-70">{event.time}</span>
                                    )}
                                    <span className="truncate">{event.title}</span>
                                  </div>
                                );
                              })}
                              {hiddenCount > 0 && (
                                <div className="text-[9px] text-zinc-400 dark:text-zinc-500 pl-1 leading-tight">
                                  +{hiddenCount}件
                                </div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* この週の複数日バー（オーバーレイ） */}
                  {weekBars.map((bar, i) => {
                    const color = bar.event.color || "#6366F1";
                    const leftPercent = (bar.gridCol / 7) * 100;
                    const widthPercent = (bar.span / 7) * 100;

                    return (
                      <div
                        key={`bar-${bar.event.id}-${weekIndex}-${i}`}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          top: `${25 + bar.lane * 18}px`,
                          height: "16px",
                          paddingLeft: "1px",
                          paddingRight: "1px",
                        }}
                      >
                        <div
                          className="h-full flex items-center overflow-hidden text-[10px] font-medium text-white leading-none px-1.5"
                          style={{
                            backgroundColor: color,
                            opacity: 0.9,
                            borderRadius: `${bar.isStart ? "3px" : "0"} ${bar.isEnd ? "3px" : "0"} ${bar.isEnd ? "3px" : "0"} ${bar.isStart ? "3px" : "0"}`,
                          }}
                        >
                          {bar.isStart && (
                            <span className="truncate">{bar.event.title}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            });
          })()}

          {/* 凡例 */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-700">
            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="w-8 h-3 rounded-sm bg-indigo-500 opacity-90" />
                複数日
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="w-1 h-3 rounded-sm bg-indigo-500" />
                スケジュール
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="w-1 h-3 rounded-sm bg-blue-500" />
                タスク
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <div className="w-1 h-3 rounded-sm bg-emerald-500" />
                試験
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="text-[10px] font-medium text-red-500">祝</span>
                祝日
              </div>
            </div>
            <span className="text-xs text-zinc-400 dark:text-zinc-500 hidden sm:inline">
              ダブルクリックで予定追加
            </span>
          </div>
        </div>

        {/* 選択日の詳細 */}
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
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
              {selectedDate && holidayMap.get(selectedDate) && (
                <p className="text-xs font-medium text-red-500 dark:text-red-400 mt-0.5">
                  {holidayMap.get(selectedDate)}
                </p>
              )}
            </div>
            {selectedDate && (
              <div className="flex gap-1">
                <button
                  onClick={() => setShowScheduleModal(true)}
                  className="flex items-center gap-1 px-2 py-1 text-sm bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900/50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  予定
                </button>
                <button
                  onClick={openCreateModal}
                  className="flex items-center gap-1 px-2 py-1 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  タスク
                </button>
              </div>
            )}
          </div>

          {selectedDate ? (
            selectedDateEvents.length > 0 ? (
              <div className="space-y-3">
                {selectedDateEvents.map((event) => (
                  <div
                    key={`${event.type}-${event.id}`}
                    className="w-full flex items-start gap-3 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-700/50 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors text-left group"
                  >
                    <button
                      onClick={() => {
                        if (event.type === "task") {
                          const path = getTaskDetailPath(event.id);
                          const separator = path.includes("?") ? "&" : "?";
                          router.push(`${path}${separator}showHeader=true`);
                        }
                      }}
                      className="flex items-start gap-3 flex-1 min-w-0"
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
                        ) : event.type === "schedule" ? (
                          <CalendarIcon className="w-4 h-4" />
                        ) : event.status === "done" ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-zinc-800 dark:text-zinc-200 text-sm truncate">
                          {event.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {event.type === "exam"
                              ? "試験"
                              : event.type === "schedule"
                                ? "スケジュール"
                                : "タスク"}
                            {event.status === "done" && " ・ 完了"}
                          </p>
                          {event.endDate && (
                            <span className="flex items-center gap-1 text-xs text-indigo-500 dark:text-indigo-400">
                              <CalendarIcon className="w-3 h-3" />
                              {new Date(event.date).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
                              {" 〜 "}
                              {new Date(event.endDate).toLocaleDateString("ja-JP", { month: "short", day: "numeric" })}
                            </span>
                          )}
                          {event.time && (
                            <span className="flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
                              <Clock className="w-3 h-3" />
                              {event.time}
                              {event.endTime && ` 〜 ${event.endTime}`}
                            </span>
                          )}
                          {event.reminderMinutes != null && (
                            <span className="flex items-center gap-1 text-xs text-amber-500">
                              <Bell className="w-3 h-3" />
                              {getReminderLabel(event.reminderMinutes)}
                            </span>
                          )}
                        </div>
                        {event.description && (
                          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 truncate">
                            {event.description}
                          </p>
                        )}
                      </div>
                    </button>
                    {event.type === "schedule" && (
                      <button
                        onClick={() => deleteScheduleEvent(event.id)}
                        className="p-1 text-zinc-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-100 dark:bg-zinc-700/50 flex items-center justify-center">
                  <CalendarIcon className="w-6 h-6 text-zinc-400 dark:text-zinc-500" />
                </div>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
                  この日の予定はありません
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    スケジュールを追加
                  </button>
                  <button
                    onClick={openCreateModal}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 text-zinc-500 dark:text-zinc-400 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-700/50 transition-colors text-sm"
                  >
                    <Plus className="w-4 h-4" />
                    タスクを追加
                  </button>
                </div>
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

      {/* スケジュール作成モーダル */}
      {showScheduleModal && selectedDate && (
        <ScheduleEventDialog
          selectedDate={selectedDate}
          onClose={() => setShowScheduleModal(false)}
          onSubmit={createScheduleEvent}
        />
      )}
    </div>
  );
}
