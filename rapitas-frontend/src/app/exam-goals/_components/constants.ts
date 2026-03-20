/**
 * ExamGoals — UI constants
 *
 * Shared constant values for the exam-goals feature.
 * Not responsible for any rendering or data logic.
 */

export const PRESET_COLORS = [
  '#10B981', // emerald
  '#3B82F6', // blue
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#F59E0B', // amber
  '#EF4444', // red
  '#06B6D4', // cyan
  '#84CC16', // lime
] as const;

export type ExamGoalFormData = {
  name: string;
  description: string;
  examDate: string;
  targetScore: string;
  color: string;
  icon: string;
};
