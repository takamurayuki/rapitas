export type Theme = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
  };
};

export type Project = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
    milestones: number;
  };
};

export type Milestone = {
  id: number;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  projectId: number;
  project?: Project;
  createdAt: string;
  updatedAt: string;
  _count?: {
    tasks: number;
  };
};

export type Priority = "low" | "medium" | "high" | "urgent";

export type Status = "todo" | "in-progress" | "done";

export type Label = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  icon?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
};

export type TaskLabel = {
  id: number;
  taskId: number;
  labelId: number;
  label?: Label;
  createdAt: string;
};

export type ExamGoal = {
  id: number;
  name: string;
  description?: string | null;
  examDate: string;
  targetScore?: string | null;
  color: string;
  icon?: string | null;
  isCompleted: boolean;
  actualScore?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { tasks: number };
};

export type StudyStreak = {
  id: number;
  date: string;
  studyMinutes: number;
  tasksCompleted: number;
  createdAt: string;
  updatedAt: string;
};

export type StudyPlanPhase = {
  name: string;
  days: number;
  tasks: string[];
  dailyHours: number;
};

export type GeneratedStudyPlan = {
  subject: string;
  targetScore?: string;
  totalDays: number;
  studyHoursPerDay: number;
  phases: StudyPlanPhase[];
  tips: string[];
};

export type StudyPlan = {
  id: number;
  examGoalId?: number | null;
  subject: string;
  prompt: string;
  generatedPlan: GeneratedStudyPlan;
  totalDays: number;
  startDate: string;
  endDate: string;
  isApplied: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: number;
  title: string;
  description?: string | null;
  status: Status;
  priority: Priority;
  labels?: string[];
  taskLabels?: TaskLabel[];
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: string | null;
  subject?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  parentId?: number | null;
  parent?: Task;
  subtasks?: Task[];
  themeId?: number | null;
  theme?: Theme | null;
  projectId?: number | null;
  project?: Project | null;
  milestoneId?: number | null;
  milestone?: Milestone | null;
  examGoalId?: number | null;
  examGoal?: ExamGoal | null;
  timeEntries?: TimeEntry[];
  comments?: Comment[];
  createdAt: string;
  updatedAt: string;
};

export type TimeEntry = {
  id: number;
  taskId: number;
  duration: number;
  breakDuration?: number | null;
  note?: string | null;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: number;
  taskId: number;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ActivityLog = {
  id: number;
  taskId?: number | null;
  projectId?: number | null;
  action: string;
  changes?: any;
  metadata?: any;
  createdAt: string;
};

export const priorityColors = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-800 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-800 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-800 dark:text-red-300",
};

export const priorityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "緊急",
};

// 実績/バッジ
export type Achievement = {
  id: number;
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  condition: any;
  rarity: "common" | "rare" | "epic" | "legendary";
  isUnlocked: boolean;
  unlockedAt: string | null;
  createdAt: string;
};

// 習慣
export type Habit = {
  id: number;
  name: string;
  description?: string | null;
  icon?: string | null;
  color: string;
  frequency: string;
  targetCount: number;
  isActive: boolean;
  logs?: HabitLog[];
  _count?: { logs: number };
  createdAt: string;
  updatedAt: string;
};

export type HabitLog = {
  id: number;
  habitId: number;
  date: string;
  count: number;
  note?: string | null;
  createdAt: string;
};

// 学習リソース
export type Resource = {
  id: number;
  taskId?: number | null;
  title: string;
  url?: string | null;
  type: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

// フラッシュカード
export type FlashcardDeck = {
  id: number;
  name: string;
  description?: string | null;
  color: string;
  taskId?: number | null;
  cards?: Flashcard[];
  _count?: { cards: number };
  createdAt: string;
  updatedAt: string;
};

export type Flashcard = {
  id: number;
  deckId: number;
  front: string;
  back: string;
  nextReview?: string | null;
  interval: number;
  easeFactor: number;
  reviewCount: number;
  deck?: FlashcardDeck;
  createdAt: string;
  updatedAt: string;
};

// タスクテンプレート
export type TaskTemplate = {
  id: number;
  name: string;
  description?: string | null;
  category: string;
  templateData: any;
  isPublic: boolean;
  useCount: number;
  createdAt: string;
  updatedAt: string;
};

// 週次レポート
export type WeeklyReport = {
  period: {
    start: string;
    end: string;
  };
  summary: {
    tasksCompleted: number;
    studyHours: number;
    tasksChange: number;
    hoursChange: number;
  };
  dailyData: {
    date: string;
    tasks: number;
    hours: number;
  }[];
  subjectBreakdown: {
    subject: string | null;
    count: number;
  }[];
};
