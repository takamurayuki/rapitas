/**
 * home-travel
 *
 * Icon registry entries for Home & Lifestyle, Travel & Outdoor, Math & Science,
 * Stationery & Office, and SNS & Web categories.
 * Part of the split icon registry — see icon-registry.ts for the full ICON_DATA export.
 */

import {
  Bed,
  Bath,
  Shirt,
  Scissors,
  Lamp,
  LampDesk,
  Armchair,
  DoorOpen,
  DoorClosed,
  Trash,
  Recycle,
  Waypoints,
  Tent,
  Backpack,
  Luggage,
  Ticket,
  Hotel,
  Binoculars,
  Axe,
  Calculator,
  FlaskConical,
  FlaskRound,
  Microscope,
  Atom,
  Orbit,
  Sigma,
  Pi,
  StickyNote,
  NotebookTabs,
  Presentation,
  Table,
  Table2,
  Stamp,
  Pin,
  PinOff,
  Rss,
  Chrome,
  Podcast,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Home & Lifestyle, Travel & Outdoor, Math & Science, Stationery & Office, and SNS & Web. */
export const HOME_TRAVEL_ICONS: Record<string, IconInfo> = {
  // Home & Lifestyle
  Bed: { component: Bed, keywords: ['ベッド', '寝る', '睡眠', '休息', '寝室'] },
  Bath: {
    component: Bath,
    keywords: ['お風呂', '入浴', 'バス', '風呂', '洗う'],
  },
  Shirt: {
    component: Shirt,
    keywords: ['シャツ', '服', '洋服', 'ファッション', '着替え'],
  },
  Scissors: {
    component: Scissors,
    keywords: ['はさみ', '切る', 'カット', '裁断', '工作'],
  },
  Lamp: {
    component: Lamp,
    keywords: ['ランプ', '照明', 'ライト', '明かり', '電灯'],
  },
  LampDesk: {
    component: LampDesk,
    keywords: ['デスクランプ', '卓上ライト', '照明', '勉強'],
  },
  Armchair: {
    component: Armchair,
    keywords: ['椅子', 'アームチェア', 'ソファ', '座る', 'リラックス'],
  },
  DoorOpen: {
    component: DoorOpen,
    keywords: ['ドア', '扉', '開く', '入口', '出口'],
  },
  DoorClosed: {
    component: DoorClosed,
    keywords: ['ドア', '扉', '閉じる', '部屋', 'プライベート'],
  },
  Trash: { component: Trash, keywords: ['ゴミ箱', '削除', '捨てる', '廃棄'] },
  Recycle: {
    component: Recycle,
    keywords: ['リサイクル', '再利用', 'エコ', '環境', '循環'],
  },
  Waypoints: {
    component: Waypoints,
    keywords: ['経路', 'ルート', '道順', 'ウェイポイント', '接続'],
  },

  // Travel & Outdoor
  Tent: {
    component: Tent,
    keywords: ['テント', 'キャンプ', 'アウトドア', '野営'],
  },
  Backpack: {
    component: Backpack,
    keywords: ['リュック', 'バックパック', 'カバン', '旅行', '通学'],
  },
  Luggage: {
    component: Luggage,
    keywords: ['スーツケース', '荷物', '旅行', '出張'],
  },
  Ticket: {
    component: Ticket,
    keywords: ['チケット', '切符', '券', '入場券', 'イベント'],
  },
  Hotel: {
    component: Hotel,
    keywords: ['ホテル', '宿泊', '旅館', '宿', '滞在'],
  },
  Binoculars: {
    component: Binoculars,
    keywords: ['双眼鏡', '観察', '探索', 'バードウォッチング'],
  },
  Axe: {
    component: Axe,
    keywords: ['斧', '薪割り', 'キャンプ', 'アウトドア', '道具'],
  },

  // Math & Science
  Calculator: {
    component: Calculator,
    keywords: ['電卓', '計算機', '計算', '数学'],
  },
  FlaskConical: {
    component: FlaskConical,
    keywords: ['フラスコ', '実験', '科学', '化学', '研究'],
  },
  FlaskRound: {
    component: FlaskRound,
    keywords: ['丸フラスコ', '実験', '科学', '化学'],
  },
  Microscope: {
    component: Microscope,
    keywords: ['顕微鏡', '観察', '科学', '研究', '分析'],
  },
  Atom: {
    component: Atom,
    keywords: ['原子', 'アトム', '科学', '物理', '化学'],
  },
  Orbit: {
    component: Orbit,
    keywords: ['軌道', 'オービット', '惑星', '宇宙', '回転'],
  },
  Sigma: {
    component: Sigma,
    keywords: ['シグマ', '合計', '数学', '統計', '関数'],
  },
  Pi: { component: Pi, keywords: ['パイ', '円周率', '数学', '数式', '計算'] },

  // Stationery & Office
  StickyNote: {
    component: StickyNote,
    keywords: ['付箋', 'メモ', 'ポストイット', 'ノート'],
  },
  NotebookTabs: {
    component: NotebookTabs,
    keywords: ['ノート', 'タブ', '整理', '分類', '手帳'],
  },
  Presentation: {
    component: Presentation,
    keywords: ['プレゼン', 'スライド', '発表', '会議'],
  },
  Table: { component: Table, keywords: ['テーブル', '表', 'データ', '一覧'] },
  Table2: {
    component: Table2,
    keywords: ['テーブル', '表', 'グリッド', 'データ'],
  },
  Stamp: {
    component: Stamp,
    keywords: ['スタンプ', 'はんこ', '印鑑', '承認', '押印'],
  },
  Pin: {
    component: Pin,
    keywords: ['ピン', '留める', '固定', '重要', 'お気に入り'],
  },
  PinOff: { component: PinOff, keywords: ['ピン解除', '外す', '固定解除'] },

  // SNS & Web
  Rss: {
    component: Rss,
    keywords: ['RSS', 'フィード', 'ニュース', '購読', '配信'],
  },
  Chrome: {
    component: Chrome,
    keywords: ['Chrome', 'ブラウザ', 'ウェブ', 'インターネット'],
  },
  Podcast: {
    component: Podcast,
    keywords: ['ポッドキャスト', '音声', '配信', '番組', 'ラジオ'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
