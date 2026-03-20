/**
 * ui-other
 *
 * Icon registry entries for Arrows & Direction, Alerts & Notifications,
 * Astronomy & Space, AI & Robotics, Layout & UI, and Other categories.
 * Part of the split icon registry — see icon-registry.ts for the full ICON_DATA export.
 */

import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowDownLeft,
  MoveUp,
  MoveDown,
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  CircleAlert,
  TriangleAlert,
  Satellite,
  SatelliteDish,
  Telescope,
  Bot,
  BrainCircuit,
  CircuitBoard,
  Workflow,
  SwatchBook,
  Layers,
  LayoutGrid,
  LayoutList,
  Columns3,
  Rows3,
  Component,
  Blocks,
  Box,
  Boxes,
  Wand2,
  Scan,
  Infinity,
  Hash,
  Asterisk,
  Plus,
  Minus,
  X,
  Divide,
  Equal,
  MoreHorizontal,
  MoreVertical,
  Grip,
  GripVertical,
  Move,
  Maximize,
  Minimize,
  Expand,
  Shrink,
  RotateCw,
  RotateCcw,
  RefreshCw,
  RefreshCcw,
  Repeat,
  Repeat1,
  Shuffle,
  FastForward,
  Rewind,
  Play,
  Pause,
  StopCircle,
  SkipForward,
  SkipBack,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Arrows, Alerts, Astronomy, AI, Layout, and other utility icons. */
export const UI_OTHER_ICONS: Record<string, IconInfo> = {
  // Arrows & Direction
  ArrowUp: {
    component: ArrowUp,
    keywords: ['上', '上向き', '矢印', 'アップ', '増加'],
  },
  ArrowDown: {
    component: ArrowDown,
    keywords: ['下', '下向き', '矢印', 'ダウン', '減少'],
  },
  ArrowLeft: {
    component: ArrowLeft,
    keywords: ['左', '左向き', '矢印', '戻る'],
  },
  ArrowRight: {
    component: ArrowRight,
    keywords: ['右', '右向き', '矢印', '進む'],
  },
  ArrowUpRight: {
    component: ArrowUpRight,
    keywords: ['右上', '矢印', '成長', '上昇', 'リンク'],
  },
  ArrowDownLeft: {
    component: ArrowDownLeft,
    keywords: ['左下', '矢印', '下降', '減少'],
  },
  MoveUp: {
    component: MoveUp,
    keywords: ['上に移動', 'アップ', '昇格', '上げる'],
  },
  MoveDown: {
    component: MoveDown,
    keywords: ['下に移動', 'ダウン', '降格', '下げる'],
  },

  // Alerts & Notifications
  AlertCircle: {
    component: AlertCircle,
    keywords: ['アラート', '警告', '注意', '丸', 'エラー'],
  },
  AlertTriangle: {
    component: AlertTriangle,
    keywords: ['アラート', '警告', '注意', '三角', '危険'],
  },
  Info: {
    component: Info,
    keywords: ['情報', 'インフォ', '詳細', 'ヘルプ', '案内'],
  },
  HelpCircle: {
    component: HelpCircle,
    keywords: ['ヘルプ', '質問', '疑問', 'サポート', '?'],
  },
  CircleAlert: {
    component: CircleAlert,
    keywords: ['警告', 'アラート', '注意', 'エラー'],
  },
  TriangleAlert: {
    component: TriangleAlert,
    keywords: ['警告', '危険', '注意', 'エラー', '三角'],
  },

  // Astronomy & Space
  Satellite: {
    component: Satellite,
    keywords: ['衛星', 'サテライト', '宇宙', '通信', 'GPS'],
  },
  SatelliteDish: {
    component: SatelliteDish,
    keywords: ['パラボラアンテナ', '受信', '通信', '放送'],
  },
  Telescope: {
    component: Telescope,
    keywords: ['望遠鏡', '天体観測', '宇宙', '星', '観察'],
  },

  // AI & Robotics
  Bot: {
    component: Bot,
    keywords: ['ボット', 'ロボット', 'AI', '自動化', 'チャット'],
  },
  BrainCircuit: {
    component: BrainCircuit,
    keywords: ['AI', '人工知能', '機械学習', 'ニューラル', '回路'],
  },
  CircuitBoard: {
    component: CircuitBoard,
    keywords: ['回路基板', '基板', '電子', 'ハードウェア'],
  },
  Workflow: {
    component: Workflow,
    keywords: ['ワークフロー', 'フロー', '自動化', 'プロセス', '手順'],
  },

  // Layout & UI
  SwatchBook: {
    component: SwatchBook,
    keywords: ['スウォッチ', 'カラーパレット', '色見本', 'テーマ'],
  },
  Layers: {
    component: Layers,
    keywords: ['レイヤー', '層', '階層', '重ね', 'スタック'],
  },
  LayoutGrid: {
    component: LayoutGrid,
    keywords: ['グリッド', 'レイアウト', '格子', '一覧'],
  },
  LayoutList: {
    component: LayoutList,
    keywords: ['リスト', 'レイアウト', '一覧', 'リスト表示'],
  },
  Columns3: {
    component: Columns3,
    keywords: ['カラム', '列', '3列', 'レイアウト'],
  },
  Rows3: { component: Rows3, keywords: ['行', 'ロー', '3行', 'レイアウト'] },
  Component: {
    component: Component,
    keywords: ['コンポーネント', '部品', 'モジュール', 'パーツ'],
  },
  Blocks: {
    component: Blocks,
    keywords: ['ブロック', '積み木', '構成', '組み立て'],
  },
  Box: {
    component: Box,
    keywords: ['ボックス', '箱', 'コンテナ', 'パッケージ'],
  },
  Boxes: {
    component: Boxes,
    keywords: ['ボックス', '箱', '複数', '在庫', '倉庫'],
  },
  Wand2: {
    component: Wand2,
    keywords: ['魔法の杖', 'ワンド', '自動', 'マジック', 'AI'],
  },
  Scan: { component: Scan, keywords: ['スキャン', '読み取り', '認識', '枠'] },

  // Other
  Infinity: {
    component: Infinity,
    keywords: ['無限', 'インフィニティ', '永遠', 'ループ'],
  },
  Hash: { component: Hash, keywords: ['ハッシュ', 'シャープ', '番号', 'タグ'] },
  Asterisk: {
    component: Asterisk,
    keywords: ['アスタリスク', '星印', '必須', '注釈'],
  },
  Plus: { component: Plus, keywords: ['プラス', '追加', '新規', '足す'] },
  Minus: { component: Minus, keywords: ['マイナス', '削除', '引く', '減らす'] },
  X: { component: X, keywords: ['バツ', '閉じる', 'キャンセル', '削除'] },
  Divide: { component: Divide, keywords: ['割る', '除算', '分割', '計算'] },
  Equal: { component: Equal, keywords: ['イコール', '等しい', '同じ', '計算'] },
  MoreHorizontal: {
    component: MoreHorizontal,
    keywords: ['もっと見る', 'メニュー', 'その他', 'オプション'],
  },
  MoreVertical: {
    component: MoreVertical,
    keywords: ['もっと見る', 'メニュー', 'その他', '縦'],
  },
  Grip: {
    component: Grip,
    keywords: ['グリップ', 'ドラッグ', '移動', 'ハンドル'],
  },
  GripVertical: {
    component: GripVertical,
    keywords: ['グリップ', 'ドラッグ', '縦', 'ハンドル'],
  },
  Move: { component: Move, keywords: ['移動', 'ムーブ', 'ドラッグ', '矢印'] },
  Maximize: {
    component: Maximize,
    keywords: ['最大化', '拡大', 'フルスクリーン'],
  },
  Minimize: { component: Minimize, keywords: ['最小化', '縮小', '閉じる'] },
  Expand: { component: Expand, keywords: ['展開', '拡大', '広げる'] },
  Shrink: { component: Shrink, keywords: ['縮小', '小さく', '縮める'] },
  RotateCw: { component: RotateCw, keywords: ['回転', '時計回り', 'リロード'] },
  RotateCcw: { component: RotateCcw, keywords: ['回転', '反時計回り', '戻す'] },
  RefreshCw: {
    component: RefreshCw,
    keywords: ['更新', 'リフレッシュ', 'リロード'],
  },
  RefreshCcw: {
    component: RefreshCcw,
    keywords: ['更新', 'リフレッシュ', '戻す'],
  },
  Repeat: { component: Repeat, keywords: ['リピート', '繰り返し', 'ループ'] },
  Repeat1: {
    component: Repeat1,
    keywords: ['リピート', '1曲リピート', '繰り返し'],
  },
  Shuffle: {
    component: Shuffle,
    keywords: ['シャッフル', 'ランダム', '混ぜる'],
  },
  FastForward: {
    component: FastForward,
    keywords: ['早送り', 'スキップ', '次へ'],
  },
  Rewind: { component: Rewind, keywords: ['巻き戻し', '戻る', '前へ'] },
  Play: { component: Play, keywords: ['再生', 'プレイ', '開始', 'スタート'] },
  Pause: { component: Pause, keywords: ['一時停止', 'ポーズ', '止める'] },
  StopCircle: { component: StopCircle, keywords: ['停止', 'ストップ', '終了'] },
  SkipForward: {
    component: SkipForward,
    keywords: ['次へ', 'スキップ', '進む'],
  },
  SkipBack: { component: SkipBack, keywords: ['前へ', '戻る', 'スキップ'] },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
