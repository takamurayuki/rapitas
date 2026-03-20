/**
 * education-tech
 *
 * Icon registry entries for Education & Learning and Technology & Devices categories.
 * Part of the split icon registry — see index.ts for the full ICON_DATA export.
 */

import {
  Book,
  BookOpen,
  BookMarked,
  Library,
  GraduationCap,
  School,
  Pencil,
  PencilLine,
  Pen,
  Eraser,
  Highlighter,
  NotebookPen,
  FileEdit,
  Laptop,
  Monitor,
  Smartphone,
  Tablet,
  Tv,
  Watch,
  Headphones,
  Speaker,
  Camera,
  Aperture,
  Image,
  Images,
  Film,
  Clapperboard,
  Radio,
  Wifi,
  WifiOff,
  Bluetooth,
  Battery,
  BatteryCharging,
  Plug,
  Power,
  Cpu,
  HardDrive,
  Database,
  Server,
  Cloud,
  CloudUpload,
  CloudDownload,
  Download,
  Upload,
  Share,
  Share2,
  QrCode,
  Printer,
  ScanLine,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Education & Learning and Technology & Devices. */
export const EDUCATION_TECH_ICONS: Record<string, IconInfo> = {
  // Education & Learning
  Book: { component: Book, keywords: ['本', 'ブック', '読書', '学習', '知識'] },
  BookOpen: { component: BookOpen, keywords: ['本', '開く', '読書中', '学習'] },
  BookMarked: {
    component: BookMarked,
    keywords: ['本', 'しおり', '読みかけ', '保存'],
  },
  Library: {
    component: Library,
    keywords: ['図書館', 'ライブラリ', '書庫', '本棚'],
  },
  GraduationCap: {
    component: GraduationCap,
    keywords: ['卒業', '学生', '大学', '学習', '教育', '帽子'],
  },
  School: { component: School, keywords: ['学校', '教育', 'スクール', '校舎'] },
  Pencil: {
    component: Pencil,
    keywords: ['鉛筆', 'ペンシル', '書く', '編集', 'メモ'],
  },
  PencilLine: {
    component: PencilLine,
    keywords: ['鉛筆', '書く', '下線', '編集'],
  },
  Pen: { component: Pen, keywords: ['ペン', '書く', '署名', '執筆'] },
  Eraser: { component: Eraser, keywords: ['消しゴム', '消す', '削除', '修正'] },
  Highlighter: {
    component: Highlighter,
    keywords: ['蛍光ペン', 'マーカー', 'ハイライト', '強調'],
  },
  NotebookPen: {
    component: NotebookPen,
    keywords: ['ノート', 'メモ', '記録', '書く'],
  },
  FileEdit: {
    component: FileEdit,
    keywords: ['ファイル編集', '文書', '修正', '更新'],
  },

  // Technology & Devices
  Laptop: {
    component: Laptop,
    keywords: ['ノートパソコン', 'ラップトップ', 'PC', 'コンピュータ'],
  },
  Monitor: {
    component: Monitor,
    keywords: ['モニター', 'ディスプレイ', '画面', 'デスクトップ'],
  },
  Smartphone: {
    component: Smartphone,
    keywords: ['スマートフォン', 'スマホ', '携帯', 'モバイル'],
  },
  Tablet: {
    component: Tablet,
    keywords: ['タブレット', 'iPad', '端末', 'デバイス'],
  },
  Tv: { component: Tv, keywords: ['テレビ', 'TV', 'モニター', '映像'] },
  Watch: {
    component: Watch,
    keywords: ['腕時計', 'ウォッチ', 'スマートウォッチ', '時計'],
  },
  Headphones: {
    component: Headphones,
    keywords: ['ヘッドホン', 'イヤホン', '音楽', 'オーディオ'],
  },
  Speaker: {
    component: Speaker,
    keywords: ['スピーカー', '音響', '音楽', 'サウンド'],
  },
  Camera: { component: Camera, keywords: ['カメラ', '写真', '撮影', 'フォト'] },
  Aperture: {
    component: Aperture,
    keywords: ['絞り', 'カメラ', 'レンズ', '撮影'],
  },
  Image: {
    component: Image,
    keywords: ['画像', '写真', 'イメージ', 'ピクチャー'],
  },
  Images: {
    component: Images,
    keywords: ['画像', 'ギャラリー', 'アルバム', '写真集'],
  },
  Film: {
    component: Film,
    keywords: ['フィルム', '映画', '動画', 'ムービー', 'シネマ'],
  },
  Clapperboard: {
    component: Clapperboard,
    keywords: ['カチンコ', '映画', '撮影', '動画'],
  },
  Radio: { component: Radio, keywords: ['ラジオ', 'FM', 'AM', '放送'] },
  Wifi: {
    component: Wifi,
    keywords: ['WiFi', 'ワイファイ', '無線', 'インターネット', '接続'],
  },
  WifiOff: {
    component: WifiOff,
    keywords: ['WiFiオフ', '接続なし', 'オフライン'],
  },
  Bluetooth: {
    component: Bluetooth,
    keywords: ['Bluetooth', 'ブルートゥース', '無線', '接続'],
  },
  Battery: {
    component: Battery,
    keywords: ['バッテリー', '電池', '充電', '残量'],
  },
  BatteryCharging: {
    component: BatteryCharging,
    keywords: ['充電中', 'バッテリー', '電池'],
  },
  Plug: { component: Plug, keywords: ['プラグ', 'コンセント', '電源', '接続'] },
  Power: {
    component: Power,
    keywords: ['電源', 'パワー', '起動', 'シャットダウン'],
  },
  Cpu: {
    component: Cpu,
    keywords: ['CPU', 'プロセッサ', 'チップ', '処理', 'コンピュータ'],
  },
  HardDrive: {
    component: HardDrive,
    keywords: ['ハードディスク', 'HDD', 'ストレージ', '保存'],
  },
  Database: {
    component: Database,
    keywords: ['データベース', 'DB', '保存', 'ストレージ'],
  },
  Server: {
    component: Server,
    keywords: ['サーバー', 'ホスト', 'バックエンド', 'システム'],
  },
  Cloud: {
    component: Cloud,
    keywords: ['クラウド', '雲', '天気', 'オンライン', '保存'],
  },
  CloudUpload: {
    component: CloudUpload,
    keywords: ['アップロード', 'クラウド', '保存', '転送'],
  },
  CloudDownload: {
    component: CloudDownload,
    keywords: ['ダウンロード', 'クラウド', '取得'],
  },
  Download: {
    component: Download,
    keywords: ['ダウンロード', '取得', '保存', '受信'],
  },
  Upload: {
    component: Upload,
    keywords: ['アップロード', '送信', '転送', '共有'],
  },
  Share: { component: Share, keywords: ['共有', 'シェア', '転送', '送る'] },
  Share2: {
    component: Share2,
    keywords: ['共有', 'シェア', '拡散', 'ネットワーク'],
  },
  QrCode: {
    component: QrCode,
    keywords: ['QRコード', 'バーコード', 'スキャン', '読み取り'],
  },
  Printer: {
    component: Printer,
    keywords: ['プリンター', '印刷', '出力', '紙'],
  },
  ScanLine: {
    component: ScanLine,
    keywords: ['スキャン', '読み取り', 'バーコード'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
