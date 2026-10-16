/**
 * roadmap.types
 *
 * Shared types for the learning roadmap (統合 StudyGoal) pages.
 */

/** Goal kind: skill acquisition (旧 学習目標) or exam (旧 試験目標). */
export type StudyGoalType = 'skill' | 'exam';

export type StudyGoalStatus = 'active' | 'completed' | 'archived';

/** Unified study goal as returned by GET /study-goals. */
export interface StudyGoal {
  id: number;
  type: StudyGoalType;
  title: string;
  description: string | null;
  deadline: string | null;
  status: StudyGoalStatus;
  color: string;
  icon: string | null;
  dailyMinutes: number;
  categoryId: number | null;
  themeId: number | null;
  currentLevel: string | null;
  targetLevel: string | null;
  targetScore: string | null;
  actualScore: string | null;
  taskCount: number;
  doneTaskCount: number;
  createdAt: string;
}

/** Editable fields for create / update. */
export interface StudyGoalDraft {
  type: StudyGoalType;
  title: string;
  description: string;
  deadline: string; // yyyy-mm-dd or ''
  dailyMinutes: number;
  currentLevel: string;
  targetLevel: string;
  targetScore: string;
  actualScore: string;
  color: string;
}

/** Pacing metrics from GET /study-goals/analytics. */
export interface StudyPace {
  quotaMinutes: number;
  avg7d: number;
  adherence7d: number;
  streakDays: number;
  crammingIndex: number | null;
  todayMinutes: number;
  total7d: number;
  total30d: number;
}

/** Technique-tagged recommendation. */
export interface RoadmapRecommendation {
  key: string;
  technique:
    | 'spacing'
    | 'retrieval'
    | 'consistency'
    | 'pacing'
    | 'zeigarnik'
    | 'interleaving'
    | 'chunking'
    | 'none';
  params?: Record<string, string | number>;
}

/** Draft for POST /study-sessions (manual time log). */
export interface StudySessionDraft {
  minutes: number;
  goalId: number | null;
  /** yyyy-mm-dd (local). */
  date: string;
  note: string;
}

/** Analytics payload. */
export interface RoadmapAnalytics {
  pace: StudyPace;
  recommendations: RoadmapRecommendation[];
  series: Array<{ date: string; minutes: number }>;
  vocabDueCount: number;
}
