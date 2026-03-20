/**
 * general
 *
 * Icon registry entries for the General category: labels, ratings, tools,
 * and other utility icons used across multiple contexts.
 * Part of the split icon registry — see icon-registry.ts for the full ICON_DATA export.
 */

import {
  Tag,
  Bookmark,
  BookmarkCheck,
  Flag,
  Star,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Award,
  Trophy,
  Medal,
  Crown,
  Gem,
  Gift,
  PartyPopper,
  Sparkles,
  Flame,
  Zap,
  Lightbulb,
  Target,
  Crosshair,
  Focus,
  Eye,
  EyeOff,
  Search,
  Filter,
  SlidersHorizontal,
  Settings,
  Settings2,
  Wrench,
  Hammer,
  Drill,
  Puzzle,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for General utility icons. */
export const GENERAL_ICONS: Record<string, IconInfo> = {
  Tag: {
    component: Tag,
    keywords: ['タグ', 'ラベル', 'マーク', 'しるし', '印'],
  },
  Bookmark: {
    component: Bookmark,
    keywords: ['ブックマーク', 'しおり', 'お気に入り', '保存'],
  },
  BookmarkCheck: {
    component: BookmarkCheck,
    keywords: ['ブックマーク', 'しおり', '完了', 'チェック'],
  },
  Flag: {
    component: Flag,
    keywords: ['フラグ', '旗', '目印', 'マーク', '重要'],
  },
  Star: {
    component: Star,
    keywords: ['スター', '星', 'お気に入り', '評価', 'レーティング'],
  },
  Heart: {
    component: Heart,
    keywords: ['ハート', '心', 'お気に入り', '好き', '愛', 'いいね'],
  },
  ThumbsUp: {
    component: ThumbsUp,
    keywords: ['いいね', 'グッド', '賛成', '良い', '親指'],
  },
  ThumbsDown: {
    component: ThumbsDown,
    keywords: ['ダメ', 'バッド', '反対', '悪い', '親指'],
  },
  Award: {
    component: Award,
    keywords: ['アワード', '賞', '表彰', 'メダル', '功績'],
  },
  Trophy: {
    component: Trophy,
    keywords: ['トロフィー', '優勝', '勝利', '達成', '成功'],
  },
  Medal: {
    component: Medal,
    keywords: ['メダル', '勲章', '賞', '金メダル', '銀メダル', '銅メダル'],
  },
  Crown: {
    component: Crown,
    keywords: ['王冠', 'クラウン', '王様', 'プレミアム', 'VIP'],
  },
  Gem: {
    component: Gem,
    keywords: ['宝石', 'ジェム', 'ダイヤ', '貴重', '特別'],
  },
  Gift: {
    component: Gift,
    keywords: ['ギフト', 'プレゼント', '贈り物', 'お祝い', '特典'],
  },
  PartyPopper: {
    component: PartyPopper,
    keywords: ['パーティー', 'お祝い', 'クラッカー', 'イベント', '祝い'],
  },
  Sparkles: {
    component: Sparkles,
    keywords: ['キラキラ', '輝き', '新しい', '特別', '魔法'],
  },
  Flame: {
    component: Flame,
    keywords: ['炎', '火', 'ホット', '人気', '燃える', '情熱'],
  },
  Zap: {
    component: Zap,
    keywords: ['稲妻', '雷', '電気', 'パワー', 'エネルギー', '速い'],
  },
  Lightbulb: {
    component: Lightbulb,
    keywords: ['電球', 'アイデア', 'ひらめき', '発想', '思いつき'],
  },
  Target: {
    component: Target,
    keywords: ['ターゲット', '目標', '的', 'ゴール', '狙い'],
  },
  Crosshair: {
    component: Crosshair,
    keywords: ['照準', 'クロスヘア', 'フォーカス', '集中'],
  },
  Focus: { component: Focus, keywords: ['フォーカス', '集中', '焦点', '注目'] },
  Eye: { component: Eye, keywords: ['目', '見る', '閲覧', 'ビュー', '表示'] },
  EyeOff: {
    component: EyeOff,
    keywords: ['非表示', '隠す', '目を閉じる', '見えない'],
  },
  Search: {
    component: Search,
    keywords: ['検索', '探す', '虫眼鏡', 'サーチ', '調べる'],
  },
  Filter: {
    component: Filter,
    keywords: ['フィルター', '絞り込み', 'ろ過', '選別'],
  },
  SlidersHorizontal: {
    component: SlidersHorizontal,
    keywords: ['スライダー', '設定', '調整', 'オプション'],
  },
  Settings: {
    component: Settings,
    keywords: ['設定', '歯車', 'オプション', '構成', '環境設定'],
  },
  Settings2: {
    component: Settings2,
    keywords: ['設定', '歯車', 'オプション', '構成'],
  },
  Wrench: {
    component: Wrench,
    keywords: ['レンチ', '工具', '修理', 'メンテナンス', '設定'],
  },
  Hammer: {
    component: Hammer,
    keywords: ['ハンマー', 'トンカチ', '工具', '建設', '作る'],
  },
  Drill: { component: Drill, keywords: ['ドリル', '工具', '穴', '建設'] },
  Puzzle: {
    component: Puzzle,
    keywords: ['パズル', '謎', 'ピース', '組み合わせ', '問題'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
