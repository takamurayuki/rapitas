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

// NOTE: Hint text moved to i18n (ideaBox.priorityHint.*); this only maps a
// priority to its message key so callers can `t(PRIORITY_HINT_KEY[priority])`.
export const PRIORITY_HINT_KEY: Record<IdeaPriority, string> = {
  urgent: 'priorityHint.urgent',
  high: 'priorityHint.high',
  medium: 'priorityHint.medium',
  low: 'priorityHint.low',
};

// Sparkles here labels the AI "code_review" source (a real state), not decoration.
export const SOURCE_ICONS: Record<string, typeof User> = {
  user: User,
  agent_execution: Bot,
  copilot: MessageSquare,
  code_review: Sparkles,
};
