/**
 * development-creative
 *
 * Icon registry entries for Development & Code, Creative & Design,
 * Sports & Exercise, and Games & Entertainment categories.
 * Part of the split icon registry — see index.ts for the full ICON_DATA export.
 */

import {
  Code,
  Code2,
  Terminal,
  Binary,
  Braces,
  FileCode,
  Bug,
  SquareTerminal,
  GitBranch,
  GitCommit,
  GitMerge,
  GitPullRequest,
  Palette,
  Paintbrush,
  PaintBucket,
  Brush,
  Pipette,
  Ruler,
  Shapes,
  Triangle,
  Pentagon,
  Hexagon,
  Octagon,
  Dumbbell,
  Bike,
  PersonStanding,
  Footprints,
  Gamepad2,
  Dice1,
  Dice5,
  Spade,
  Club,
  Diamond,
  Music,
  Music2,
  Music4,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Development & Code, Creative & Design, Sports & Exercise, and Games & Entertainment. */
export const DEVELOPMENT_CREATIVE_ICONS: Record<string, IconInfo> = {
  // Development & Code
  Code: {
    component: Code,
    keywords: ['コード', 'プログラミング', '開発', 'HTML', 'タグ'],
  },
  Code2: {
    component: Code2,
    keywords: ['コード', 'プログラミング', '開発', 'スクリプト'],
  },
  Terminal: {
    component: Terminal,
    keywords: ['ターミナル', 'コンソール', 'コマンドライン', 'CLI'],
  },
  Binary: {
    component: Binary,
    keywords: ['バイナリ', '2進数', 'データ', 'コード'],
  },
  Braces: {
    component: Braces,
    keywords: ['中括弧', 'ブレース', 'コード', 'JSON'],
  },
  FileCode: {
    component: FileCode,
    keywords: ['コードファイル', 'ソースコード', 'プログラム'],
  },
  Bug: {
    component: Bug,
    keywords: ['バグ', '虫', 'エラー', '不具合', 'デバッグ'],
  },
  SquareTerminal: {
    component: SquareTerminal,
    keywords: ['ターミナル', 'コンソール', '開発'],
  },
  GitBranch: {
    component: GitBranch,
    keywords: ['Git', 'ブランチ', '分岐', 'バージョン管理'],
  },
  GitCommit: {
    component: GitCommit,
    keywords: ['Git', 'コミット', '保存', '変更'],
  },
  GitMerge: {
    component: GitMerge,
    keywords: ['Git', 'マージ', '統合', '結合'],
  },
  GitPullRequest: {
    component: GitPullRequest,
    keywords: [
      'Git',
      'プルリクエスト',
      'PR',
      'レビュー',
      'GitHub',
      'ギットハブ',
      'リポジトリ',
      'オープンソース',
    ],
  },

  // Creative & Design
  Palette: {
    component: Palette,
    keywords: ['パレット', '色', 'デザイン', 'アート', '絵の具'],
  },
  Paintbrush: {
    component: Paintbrush,
    keywords: ['絵筆', 'ブラシ', '描く', 'アート'],
  },
  PaintBucket: {
    component: PaintBucket,
    keywords: ['ペイント', '塗りつぶし', '色', '塗装'],
  },
  Brush: {
    component: Brush,
    keywords: ['ブラシ', '筆', '描く', 'クリーニング'],
  },
  Pipette: {
    component: Pipette,
    keywords: ['スポイト', 'ピペット', '色抽出', 'カラーピッカー'],
  },
  Ruler: { component: Ruler, keywords: ['定規', 'ルーラー', '測定', 'サイズ'] },
  Shapes: {
    component: Shapes,
    keywords: ['図形', 'シェイプ', '形', 'デザイン'],
  },
  Triangle: {
    component: Triangle,
    keywords: ['三角', 'トライアングル', '図形', '警告'],
  },
  Pentagon: { component: Pentagon, keywords: ['五角形', 'ペンタゴン', '図形'] },
  Hexagon: { component: Hexagon, keywords: ['六角形', 'ヘキサゴン', '図形'] },
  Octagon: {
    component: Octagon,
    keywords: ['八角形', 'オクタゴン', 'ストップ', '停止'],
  },

  // Sports & Exercise
  Dumbbell: {
    component: Dumbbell,
    keywords: ['ダンベル', '筋トレ', '運動', 'フィットネス', 'ジム'],
  },
  Bike: {
    component: Bike,
    keywords: ['自転車', 'サイクリング', 'バイク', '運動'],
  },
  PersonStanding: {
    component: PersonStanding,
    keywords: ['人', '立つ', '姿勢', 'ポーズ'],
  },
  Footprints: {
    component: Footprints,
    keywords: ['足跡', '歩く', 'ウォーキング', '散歩', '歩数'],
  },

  // Games & Entertainment
  Gamepad2: {
    component: Gamepad2,
    keywords: ['ゲームパッド', 'コントローラー', 'ゲーム', '遊び'],
  },
  Dice1: {
    component: Dice1,
    keywords: ['サイコロ', 'ダイス', 'ゲーム', '運', '1'],
  },
  Dice5: {
    component: Dice5,
    keywords: ['サイコロ', 'ダイス', 'ゲーム', '運', '5'],
  },
  Spade: {
    component: Spade,
    keywords: ['スペード', 'トランプ', 'カード', 'ゲーム'],
  },
  Club: {
    component: Club,
    keywords: ['クラブ', 'トランプ', 'カード', 'ゲーム'],
  },
  Diamond: {
    component: Diamond,
    keywords: ['ダイヤ', 'トランプ', 'カード', '宝石'],
  },
  Music: { component: Music, keywords: ['音楽', 'ミュージック', '音符', '曲'] },
  Music2: {
    component: Music2,
    keywords: ['音楽', 'ミュージック', '音符', 'メロディ'],
  },
  Music4: {
    component: Music4,
    keywords: ['音楽', 'ミュージック', '音符', '楽譜'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
