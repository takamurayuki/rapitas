"use client";
import { useEffect, useState } from "react";
import type { WeeklyReport } from "@/types";
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  CheckCircle2,
  Clock,
  BarChart3,
} from "lucide-react";
import { API_BASE_URL } from "@/utils/api";
import BurndownChart from "@/components/BurndownChart";

export default function ReportsPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchReport();
  }, []);

  const fetchReport = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/reports/weekly`);
      if (res.ok) {
        setReport(await res.json());
      }
    } catch (e) {
      console.error("Failed to fetch report:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/export/tasks`);
      if (res.ok) {
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `rapitas-export-${new Date().toISOString().split("T")[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error("Failed to export:", e);
    }
  };

  const getTrend = (value: number) => {
    if (value > 0) return { icon: TrendingUp, color: "text-emerald-500", text: `+${value}` };
    if (value < 0) return { icon: TrendingDown, color: "text-red-500", text: `${value}` };
    return { icon: Minus, color: "text-zinc-400", text: "±0" };
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
          <div className="h-64 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="max-w-4xl mx-auto p-6 text-center py-12">
        <FileText className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
        <p className="text-zinc-500 dark:text-zinc-400">
          レポートを取得できませんでした
        </p>
      </div>
    );
  }

  const tasksTrend = getTrend(report.summary.tasksChange);
  const hoursTrend = getTrend(report.summary.hoursChange);
  const maxDailyTasks = Math.max(...report.dailyData.map((d) => d.tasks), 1);
  const maxDailyHours = Math.max(...report.dailyData.map((d) => d.hours), 1);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-indigo-500" />
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              週次レポート
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {new Date(report.period.start).toLocaleDateString("ja-JP")} 〜{" "}
              {new Date(report.period.end).toLocaleDateString("ja-JP")}
            </p>
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        >
          <Download className="w-4 h-4" />
          <span>エクスポート</span>
        </button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <CheckCircle2 className="w-5 h-5" />
              <span className="text-sm">完了タスク</span>
            </div>
            <div className={`flex items-center gap-1 text-sm ${tasksTrend.color}`}>
              <tasksTrend.icon className="w-4 h-4" />
              <span>{tasksTrend.text}</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            {report.summary.tasksCompleted}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            先週比
          </p>
        </div>

        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
              <Clock className="w-5 h-5" />
              <span className="text-sm">学習時間</span>
            </div>
            <div className={`flex items-center gap-1 text-sm ${hoursTrend.color}`}>
              <hoursTrend.icon className="w-4 h-4" />
              <span>{hoursTrend.text}h</span>
            </div>
          </div>
          <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-50">
            {report.summary.studyHours}h
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            先週比
          </p>
        </div>
      </div>

      {/* 日別グラフ */}
      <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4 mb-6">
        <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          日別推移
        </h2>

        <div className="space-y-6">
          {/* タスク完了グラフ */}
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">タスク完了数</p>
            <div className="flex items-end gap-2 h-24">
              {report.dailyData.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-indigo-500 rounded-t transition-all"
                    style={{
                      height: `${(day.tasks / maxDailyTasks) * 100}%`,
                      minHeight: day.tasks > 0 ? "4px" : "0",
                    }}
                  />
                  <span className="text-xs text-zinc-400 mt-1">
                    {new Date(day.date).toLocaleDateString("ja-JP", { weekday: "short" })}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 学習時間グラフ */}
          <div>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-2">学習時間</p>
            <div className="flex items-end gap-2 h-24">
              {report.dailyData.map((day) => (
                <div key={day.date} className="flex-1 flex flex-col items-center">
                  <div
                    className="w-full bg-emerald-500 rounded-t transition-all"
                    style={{
                      height: `${(day.hours / maxDailyHours) * 100}%`,
                      minHeight: day.hours > 0 ? "4px" : "0",
                    }}
                  />
                  <span className="text-xs text-zinc-400 mt-1">
                    {day.hours.toFixed(1)}h
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* バーンダウンチャート */}
      <BurndownChart className="mb-6" />

      {/* 科目別内訳 */}
      {report.subjectBreakdown.length > 0 && (
        <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-4">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200 mb-4">
            科目別内訳
          </h2>
          <div className="space-y-3">
            {report.subjectBreakdown.map((item) => {
              const total = report.subjectBreakdown.reduce((sum, i) => sum + i.count, 0);
              const percentage = Math.round((item.count / total) * 100);

              return (
                <div key={item.subject || "other"}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-zinc-700 dark:text-zinc-300">
                      {item.subject || "その他"}
                    </span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {item.count}件 ({percentage}%)
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
