"use client";
import { useScheduleReminders } from "@/hooks/use-schedule-reminders";

/**
 * スケジュールリマインド通知をバックグラウンドでチェックするプロバイダー
 * アプリ全体で1つだけマウントされるようにlayoutに配置する
 */
export default function ScheduleReminderProvider() {
  useScheduleReminders();
  return null;
}
