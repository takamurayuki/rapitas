/**
 * navigation-people
 *
 * Icon registry entries for Navigation & Location, People & Users, and Communication categories.
 * Part of the split icon registry — see index.ts for the full ICON_DATA export.
 */

import {
  Home,
  MapPin,
  Map as MapIcon,
  Navigation,
  Compass,
  Globe,
  Globe2,
  Earth,
  User,
  UserCircle,
  UserCheck,
  UserPlus,
  Users,
  UsersRound,
  UserCog,
  Contact,
  BadgeCheck,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Phone,
  PhoneCall,
  Video,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Bell,
  BellRing,
  BellOff,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Navigation & Location, People & Users, and Communication. */
export const NAVIGATION_PEOPLE_ICONS: Record<string, IconInfo> = {
  // Navigation & Location
  Home: {
    component: Home,
    keywords: ['ホーム', '家', 'トップ', 'メイン', '自宅'],
  },
  MapPin: {
    component: MapPin,
    keywords: ['マップピン', '場所', '位置', '地図', 'スポット'],
  },
  Map: { component: MapIcon, keywords: ['マップ', '地図', 'ナビ', '案内'] },
  Navigation: {
    component: Navigation,
    keywords: ['ナビゲーション', '案内', '方向', '矢印'],
  },
  Compass: {
    component: Compass,
    keywords: ['コンパス', '方位', '方向', '探検'],
  },
  Globe: {
    component: Globe,
    keywords: ['地球', 'グローバル', '世界', 'インターナショナル', '国際'],
  },
  Globe2: {
    component: Globe2,
    keywords: ['地球', 'グローバル', '世界', 'ワールド'],
  },
  Earth: {
    component: Earth,
    keywords: ['地球', 'アース', '世界', '環境', '自然'],
  },

  // People & Users
  User: {
    component: User,
    keywords: ['ユーザー', '人', 'アカウント', 'プロフィール', '個人'],
  },
  UserCircle: {
    component: UserCircle,
    keywords: ['ユーザー', 'アバター', 'プロフィール', 'アカウント'],
  },
  UserCheck: {
    component: UserCheck,
    keywords: ['ユーザー確認', '認証済み', '承認'],
  },
  UserPlus: {
    component: UserPlus,
    keywords: ['ユーザー追加', '友達追加', '新規登録'],
  },
  Users: {
    component: Users,
    keywords: ['ユーザー', 'グループ', 'チーム', 'メンバー', '複数人'],
  },
  UsersRound: {
    component: UsersRound,
    keywords: ['ユーザー', 'グループ', 'チーム', 'コミュニティ'],
  },
  UserCog: {
    component: UserCog,
    keywords: ['ユーザー設定', 'アカウント設定', '管理者'],
  },
  Contact: {
    component: Contact,
    keywords: ['連絡先', 'コンタクト', 'アドレス帳', '名刺'],
  },
  BadgeCheck: {
    component: BadgeCheck,
    keywords: ['認証バッジ', '公式', '確認済み', '信頼'],
  },

  // Communication
  MessageCircle: {
    component: MessageCircle,
    keywords: ['メッセージ', 'チャット', '会話', 'コメント', '吹き出し'],
  },
  MessageSquare: {
    component: MessageSquare,
    keywords: ['メッセージ', 'チャット', 'コメント', '会話'],
  },
  MessagesSquare: {
    component: MessagesSquare,
    keywords: ['会話', 'チャット', 'ディスカッション', '議論'],
  },
  Phone: { component: Phone, keywords: ['電話', '通話', '連絡', 'フォン'] },
  PhoneCall: {
    component: PhoneCall,
    keywords: ['電話', '着信', '通話中', 'コール'],
  },
  Video: {
    component: Video,
    keywords: ['ビデオ', '動画', '録画', 'カメラ', '通話'],
  },
  Mic: { component: Mic, keywords: ['マイク', '音声', '録音', '発言'] },
  MicOff: { component: MicOff, keywords: ['ミュート', 'マイクオフ', '消音'] },
  Volume2: {
    component: Volume2,
    keywords: ['音量', 'スピーカー', '音声', 'サウンド'],
  },
  VolumeX: {
    component: VolumeX,
    keywords: ['ミュート', '消音', '音なし', 'サイレント'],
  },
  Bell: { component: Bell, keywords: ['ベル', '通知', 'お知らせ', 'アラート'] },
  BellRing: {
    component: BellRing,
    keywords: ['ベル', '通知', '鳴動', 'アラート'],
  },
  BellOff: {
    component: BellOff,
    keywords: ['通知オフ', 'ミュート', 'おやすみ'],
  },
  Megaphone: {
    component: Megaphone,
    keywords: ['メガホン', '拡声器', 'お知らせ', '告知', '宣伝'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
