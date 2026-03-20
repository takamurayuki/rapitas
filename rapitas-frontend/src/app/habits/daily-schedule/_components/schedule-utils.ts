/**
 * daily-schedule/_components/schedule-utils
 *
 * Pure utility functions and constants for the daily-schedule feature.
 * No React imports, no side effects — safe to import from any context.
 */

import {
  Moon,
  Briefcase,
  Dumbbell,
  UtensilsCrossed,
  Train,
  BookOpen,
  Gamepad2,
  HelpCircle,
} from 'lucide-react';

export const CATEGORY_OPTIONS = [
  {
    value: 'sleep',
    labelKey: 'categorySleep' as const,
    icon: Moon,
    defaultColor: '#6366F1',
  },
  {
    value: 'work',
    labelKey: 'categoryWork' as const,
    icon: Briefcase,
    defaultColor: '#3B82F6',
  },
  {
    value: 'exercise',
    labelKey: 'categoryExercise' as const,
    icon: Dumbbell,
    defaultColor: '#10B981',
  },
  {
    value: 'meal',
    labelKey: 'categoryMeal' as const,
    icon: UtensilsCrossed,
    defaultColor: '#F59E0B',
  },
  {
    value: 'commute',
    labelKey: 'categoryCommute' as const,
    icon: Train,
    defaultColor: '#8B5CF6',
  },
  {
    value: 'study',
    labelKey: 'categoryStudy' as const,
    icon: BookOpen,
    defaultColor: '#EC4899',
  },
  {
    value: 'hobby',
    labelKey: 'categoryHobby' as const,
    icon: Gamepad2,
    defaultColor: '#06B6D4',
  },
  {
    value: 'other',
    labelKey: 'categoryOther' as const,
    icon: HelpCircle,
    defaultColor: '#94A3B8',
  },
] as const;

export const PRESET_COLORS = [
  '#6366F1',
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#EF4444',
  '#84CC16',
  '#94A3B8',
] as const;

/**
 * Returns the Lucide icon component for a given category value.
 *
 * @param category - Category string value / カテゴリ文字列
 * @returns The icon component, falling back to HelpCircle / アイコンコンポーネント
 */
export function getCategoryIcon(category: string) {
  const found = CATEGORY_OPTIONS.find((c) => c.value === category);
  return found?.icon || HelpCircle;
}

/**
 * Converts an HH:MM time string to total minutes from midnight.
 *
 * @param time - Time string in "HH:MM" format / "HH:MM"形式の時刻文字列
 * @returns Total minutes since midnight / 午前0時からの経過分数
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Converts total minutes from midnight to a clock angle in degrees.
 * 0:00 maps to the top of the circle (−90°).
 *
 * @param minutes - Minutes since midnight / 午前0時からの経過分数
 * @returns Angle in degrees / 角度（度数）
 */
export function minutesToAngle(minutes: number): number {
  // NOTE: Subtract 90 so that 0:00 aligns with the top of the SVG circle.
  return (minutes / 1440) * 360 - 90;
}

/**
 * Computes the (x, y) position of a point on a circle.
 *
 * @param cx - Circle center x / 円の中心X座標
 * @param cy - Circle center y / 円の中心Y座標
 * @param r - Radius / 半径
 * @param angleDeg - Angle in degrees / 角度（度数）
 * @returns Cartesian coordinates / 直交座標
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

/**
 * Returns the hours and minutes components of a block's duration.
 * Handles overnight blocks (end < start) and caps at 24 hours.
 *
 * @param startTime - Block start in "HH:MM" / 開始時刻
 * @param endTime - Block end in "HH:MM" / 終了時刻
 * @returns Hours and minutes components / 時間と分の内訳
 */
export function getDurationParts(
  startTime: string,
  endTime: string,
): { h: number; m: number } {
  const start = timeToMinutes(startTime);
  let end = timeToMinutes(endTime);

  if (end <= start) {
    end += 1440; // Handle overnight blocks
  }

  const diff = Math.min(end - start, 1440); // Cap at 24 hours
  return { h: Math.floor(diff / 60), m: diff % 60 };
}
