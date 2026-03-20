/**
 * agents/memory/types
 *
 * Shared TypeScript interfaces for the Agent Memory analytics page.
 * No runtime logic — types only.
 */

export interface GrowthTimelineEntry {
  date: string;
  knowledgeNodes: number;
  knowledgeEdges: number;
  learningPatterns: number;
  experimentsCompleted: number;
  successRate: number;
  avgConfidence: number;
  promptImprovements: number;
}

export interface GrowthTimeline {
  timeline: GrowthTimelineEntry[];
  period: '7d' | '30d' | 'all';
  totalDays: number;
}

export interface MemoryOverview {
  totalMemorySize: {
    nodes: number;
    patterns: number;
    episodes: number;
    experiments: number;
  };
  growthRate: {
    weekly: number;
    monthly: number;
  };
  currentSuccessRate: number;
  memoryStrength: {
    score: number;
    level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  };
  recentHighlights: {
    latestPatterns: Array<{
      id: number;
      description: string;
      confidence: number;
      createdAt: string;
    }>;
    latestNodes: Array<{
      id: number;
      label: string;
      nodeType: string;
      weight: number;
      createdAt: string;
    }>;
  };
  knowledgeDistribution: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
}
