/**
 * IdeaBoxUtils
 *
 * Pure constants and mappings for the IdeaBox feature (priority/source metadata).
 * No runtime logic — display lookups only.
 */
import { Bot, MessageSquare, Sparkles, User } from 'lucide-react';
import type { IdeaPriority } from './idea-box.types';

/**
 * Idea priority = how much it would innovate / raise the app's value if built.
 * Rendered with the same PriorityIcon as the task list for consistency.
 */
export const PRIORITY_ORDER: IdeaPriority[] = ['urgent', 'high', 'medium', 'low'];

export const PRIORITY_HINT: Record<IdeaPriority, string> = {
  urgent: '最優先で取り組むべき',
  high: '革新的・アプリ価値を大きく底上げ',
  medium: '着実に価値を高める',
  low: '小さな改善・あれば良い',
};

// Sparkles here labels the AI "code_review" source (a real state), not decoration.
export const SOURCE_ICONS: Record<string, typeof User> = {
  user: User,
  agent_execution: Bot,
  copilot: MessageSquare,
  code_review: Sparkles,
};
