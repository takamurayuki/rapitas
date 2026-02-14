export interface FavoriteLink {
  id: number;
  title: string;
  url: string;
  description?: string;
  icon?: string;
  color: string;
  category?: string;
  tags: string[];
  sortOrder: number;
  lastVisited?: string;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFavoriteLinkData {
  title: string;
  url: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  tags?: string[];
  sortOrder?: number;
}

export interface UpdateFavoriteLinkData extends Partial<CreateFavoriteLinkData> {}

export const FAVORITE_LINK_CATEGORIES = [
  { value: 'documentation', label: 'ドキュメント', icon: '📚' },
  { value: 'tools', label: 'ツール', icon: '🛠️' },
  { value: 'reference', label: 'リファレンス', icon: '📖' },
  { value: 'tutorial', label: 'チュートリアル', icon: '📝' },
  { value: 'community', label: 'コミュニティ', icon: '👥' },
  { value: 'news', label: 'ニュース', icon: '📰' },
  { value: 'other', label: 'その他', icon: '🔗' },
] as const;

export const DEFAULT_COLORS = [
  '#3B82F6', // Blue
  '#8B5CF6', // Purple
  '#10B981', // Green
  '#F59E0B', // Amber
  '#EF4444', // Red
  '#6366F1', // Indigo
  '#EC4899', // Pink
  '#14B8A6', // Teal
] as const;