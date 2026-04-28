import type {
  Achievement,
  AchievementCategory,
  Badge,
  AchievementRarity,
} from '@/types/achievement';

export const ACHIEVEMENT_CATEGORIES: AchievementCategory[] = [
  { id: 'tasks', label: 'Tasks', icon: 'CheckSquare' },
  { id: 'study', label: 'Study', icon: 'Clock' },
  { id: 'ai', label: 'AI', icon: 'Bot' },
];

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_steps',
    name: 'First Steps',
    title: 'First Steps',
    description: 'Complete your first task',
    icon: 'Trophy',
    category: 'tasks',
    rarity: 'common',
    pointsReward: 10,
    metric: 'totalTasksCompleted',
    targetValue: 1,
  },
  {
    id: 'task_master',
    name: 'Task Master',
    title: 'Task Master',
    description: 'Complete 10 tasks',
    icon: 'Award',
    category: 'tasks',
    rarity: 'rare',
    pointsReward: 50,
    metric: 'totalTasksCompleted',
    targetValue: 10,
  },
  {
    id: 'lightning_fast',
    name: 'Lightning Fast',
    title: 'Lightning Fast',
    description: 'Complete 5 tasks in one day',
    icon: 'Sparkles',
    category: 'tasks',
    rarity: 'rare',
    pointsReward: 30,
    metric: 'tasksCompletedToday',
    targetValue: 5,
  },
  {
    id: 'study_rookie',
    name: 'Study Rookie',
    title: 'Study Rookie',
    description: 'Study for 10 hours',
    icon: 'Star',
    category: 'study',
    rarity: 'common',
    pointsReward: 25,
    metric: 'totalStudyTimeMinutes',
    targetValue: 600,
  },
  {
    id: 'daily_learner',
    name: 'Daily Learner',
    title: 'Daily Learner',
    description: 'Keep a 7-day study streak',
    icon: 'Star',
    category: 'study',
    rarity: 'rare',
    pointsReward: 40,
    metric: 'currentStudyStreak',
    targetValue: 7,
  },
  {
    id: 'ai_beginner',
    name: 'AI Beginner',
    title: 'AI Beginner',
    description: 'Run your first AI agent execution',
    icon: 'Bot',
    category: 'ai',
    rarity: 'common',
    pointsReward: 10,
    metric: 'totalAgentExecutions',
    targetValue: 1,
  },
  {
    id: 'automation_expert',
    name: 'Automation Expert',
    title: 'Automation Expert',
    description: 'Run 10 AI agent executions',
    icon: 'Bot',
    category: 'ai',
    rarity: 'epic',
    pointsReward: 75,
    metric: 'totalAgentExecutions',
    targetValue: 10,
  },
  {
    id: 'consistency_champion',
    name: 'Consistency Champion',
    title: 'Consistency Champion',
    description: 'Keep a 30-day task streak',
    icon: 'Crown',
    category: 'tasks',
    rarity: 'epic',
    pointsReward: 100,
    metric: 'currentTaskStreak',
    targetValue: 30,
  },
  {
    id: 'productivity_beast',
    name: 'Productivity Beast',
    title: 'Productivity Beast',
    description: 'Complete 1000 tasks',
    icon: 'Crown',
    category: 'tasks',
    rarity: 'legendary',
    pointsReward: 500,
    metric: 'totalTasksCompleted',
    targetValue: 1000,
  },
];

export const BADGES: Badge[] = [
  {
    id: 'task_novice',
    name: 'Task Novice',
    description: 'Unlocked by completing core task achievements',
    icon: 'Award',
    requiredAchievements: ['first_steps', 'task_master'],
  },
  {
    id: 'ai_collaborator',
    name: 'AI Collaborator',
    description: 'Unlocked by using AI automation',
    icon: 'Bot',
    requiredAchievements: ['ai_beginner', 'automation_expert'],
  },
];

export function getAchievementById(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

export function getRarityColor(rarity: AchievementRarity | string): string {
  switch (rarity) {
    case 'legendary':
      return '#F59E0B';
    case 'epic':
      return '#8B5CF6';
    case 'rare':
      return '#3B82F6';
    default:
      return '#10B981';
  }
}
