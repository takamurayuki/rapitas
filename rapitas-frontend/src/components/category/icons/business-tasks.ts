/**
 * business-tasks
 *
 * Icon registry entries for Business, Time & Calendar, and Checks & Tasks categories.
 * Part of the split icon registry — see icon-registry.ts for the full ICON_DATA export.
 */

import {
  Briefcase,
  Building,
  Building2,
  Factory,
  Landmark,
  Store,
  Wallet,
  CreditCard,
  Banknote,
  Coins,
  PiggyBank,
  Receipt,
  FileText,
  FileCheck,
  FilePlus,
  FileQuestion,
  FileWarning,
  Files,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderCheck,
  Archive,
  Inbox,
  Mail,
  MailOpen,
  Send,
  AtSign,
  Paperclip,
  Link,
  Unlink,
  Clock,
  Timer,
  TimerOff,
  Hourglass,
  Calendar,
  CalendarDays,
  CalendarCheck,
  CalendarPlus,
  CalendarClock,
  AlarmClock,
  History,
  Check,
  CheckCircle,
  CheckSquare,
  CircleDot,
  Circle,
  Square,
  ListTodo,
  ListChecks,
  ClipboardList,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Business, Time & Calendar, and Checks & Tasks. */
export const BUSINESS_TASKS_ICONS: Record<string, IconInfo> = {
  // Business
  Briefcase: {
    component: Briefcase,
    keywords: ['ブリーフケース', '仕事', 'ビジネス', '書類', '出張'],
  },
  Building: {
    component: Building,
    keywords: ['ビル', '建物', '会社', 'オフィス', '企業'],
  },
  Building2: {
    component: Building2,
    keywords: ['ビル', '建物', '会社', 'オフィス', 'マンション'],
  },
  Factory: {
    component: Factory,
    keywords: ['工場', '製造', '産業', 'ファクトリー'],
  },
  Landmark: {
    component: Landmark,
    keywords: ['ランドマーク', '銀行', '政府', '公共', '建物'],
  },
  Store: {
    component: Store,
    keywords: ['店', 'ストア', 'ショップ', '店舗', '小売'],
  },
  Wallet: {
    component: Wallet,
    keywords: ['財布', 'ウォレット', 'お金', '支払い', '決済'],
  },
  CreditCard: {
    component: CreditCard,
    keywords: ['クレジットカード', 'カード', '支払い', '決済'],
  },
  Banknote: {
    component: Banknote,
    keywords: ['紙幣', 'お札', 'お金', '現金', '支払い'],
  },
  Coins: { component: Coins, keywords: ['コイン', '硬貨', 'お金', '小銭'] },
  PiggyBank: {
    component: PiggyBank,
    keywords: ['貯金箱', '貯金', '節約', '貯める', 'ブタ'],
  },
  Receipt: {
    component: Receipt,
    keywords: ['レシート', '領収書', '明細', '請求書'],
  },
  FileText: {
    component: FileText,
    keywords: ['ファイル', '文書', 'テキスト', '書類', 'ドキュメント'],
  },
  FileCheck: {
    component: FileCheck,
    keywords: ['ファイル', '完了', '確認', '承認'],
  },
  FilePlus: {
    component: FilePlus,
    keywords: ['ファイル', '追加', '新規', '作成'],
  },
  FileQuestion: {
    component: FileQuestion,
    keywords: ['ファイル', '質問', '不明', 'ヘルプ'],
  },
  FileWarning: {
    component: FileWarning,
    keywords: ['ファイル', '警告', '注意', 'エラー'],
  },
  Files: { component: Files, keywords: ['ファイル', '複数', '書類', '資料'] },
  Folder: {
    component: Folder,
    keywords: ['フォルダ', 'ディレクトリ', '整理', '分類'],
  },
  FolderOpen: {
    component: FolderOpen,
    keywords: ['フォルダ', '開く', 'ディレクトリ', 'カテゴリ'],
  },
  FolderPlus: {
    component: FolderPlus,
    keywords: ['フォルダ', '追加', '新規', '作成'],
  },
  FolderCheck: {
    component: FolderCheck,
    keywords: ['フォルダ', '完了', '確認', '承認'],
  },
  Archive: {
    component: Archive,
    keywords: ['アーカイブ', '保管', '保存', '倉庫'],
  },
  Inbox: {
    component: Inbox,
    keywords: ['受信箱', 'インボックス', 'メール', '受信'],
  },
  Mail: {
    component: Mail,
    keywords: ['メール', '手紙', '封筒', '連絡', 'お知らせ'],
  },
  MailOpen: {
    component: MailOpen,
    keywords: ['メール', '開封', '既読', '手紙'],
  },
  Send: { component: Send, keywords: ['送信', '送る', '紙飛行機', '転送'] },
  AtSign: {
    component: AtSign,
    keywords: ['アットマーク', 'メール', 'アドレス', 'ユーザー名'],
  },
  Paperclip: {
    component: Paperclip,
    keywords: ['クリップ', '添付', 'ファイル添付', 'ペーパークリップ'],
  },
  Link: {
    component: Link,
    keywords: ['リンク', 'URL', 'チェーン', '接続', 'つながり'],
  },
  Unlink: {
    component: Unlink,
    keywords: ['リンク解除', '切断', '外す', '解除'],
  },

  // Time & Calendar
  Clock: { component: Clock, keywords: ['時計', '時間', 'タイム', '時刻'] },
  Timer: {
    component: Timer,
    keywords: ['タイマー', 'ストップウォッチ', '計測', '時間制限'],
  },
  TimerOff: {
    component: TimerOff,
    keywords: ['タイマー停止', 'ストップ', '終了'],
  },
  Hourglass: {
    component: Hourglass,
    keywords: ['砂時計', '待ち', '時間経過', '待機'],
  },
  Calendar: {
    component: Calendar,
    keywords: ['カレンダー', '日付', '予定', 'スケジュール'],
  },
  CalendarDays: {
    component: CalendarDays,
    keywords: ['カレンダー', '日付', '予定', '日程'],
  },
  CalendarCheck: {
    component: CalendarCheck,
    keywords: ['カレンダー', '予定確認', '予約完了'],
  },
  CalendarPlus: {
    component: CalendarPlus,
    keywords: ['カレンダー', '予定追加', '予約'],
  },
  CalendarClock: {
    component: CalendarClock,
    keywords: ['カレンダー', '日時', 'スケジュール', '時間'],
  },
  AlarmClock: {
    component: AlarmClock,
    keywords: ['目覚まし時計', 'アラーム', '起床', '通知'],
  },
  History: {
    component: History,
    keywords: ['履歴', '歴史', '過去', 'ヒストリー', '記録'],
  },

  // Checks & Tasks
  Check: {
    component: Check,
    keywords: ['チェック', '完了', '確認', 'OK', '済み'],
  },
  CheckCircle: {
    component: CheckCircle,
    keywords: ['チェック', '完了', '成功', '確認済み'],
  },
  CheckSquare: {
    component: CheckSquare,
    keywords: ['チェックボックス', '完了', '選択済み'],
  },
  CircleDot: {
    component: CircleDot,
    keywords: ['丸', '選択', 'ラジオボタン', '現在地'],
  },
  Circle: { component: Circle, keywords: ['丸', '円', '未選択', '空'] },
  Square: { component: Square, keywords: ['四角', 'ボックス', '未選択'] },
  ListTodo: {
    component: ListTodo,
    keywords: ['ToDoリスト', 'タスク', 'やること', 'リスト'],
  },
  ListChecks: {
    component: ListChecks,
    keywords: ['チェックリスト', '完了リスト', '確認'],
  },
  ClipboardList: {
    component: ClipboardList,
    keywords: ['クリップボード', 'リスト', '一覧', '確認'],
  },
  ClipboardCheck: {
    component: ClipboardCheck,
    keywords: ['クリップボード', '完了', '確認済み'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
