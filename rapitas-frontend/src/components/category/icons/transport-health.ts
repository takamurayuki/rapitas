/**
 * transport-health
 *
 * Icon registry entries for Vehicles & Transport, Health & Medical,
 * Emotions & Expressions, Shopping, and Security categories.
 * Part of the split icon registry — see index.ts for the full ICON_DATA export.
 */

import {
  Car,
  CarFront,
  Bus,
  Train,
  TramFront,
  Ship,
  Sailboat,
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  Rocket,
  Fuel,
  ParkingCircle,
  TrafficCone,
  Activity,
  HeartPulse,
  Stethoscope,
  Pill,
  Syringe,
  Bandage,
  Cross,
  Hospital,
  Ambulance,
  Baby,
  Brain,
  Bone,
  Ear,
  HandMetal,
  Smile,
  Frown,
  Meh,
  Angry,
  Laugh,
  SmilePlus,
  Annoyed,
  ShoppingCart,
  ShoppingBag,
  ShoppingBasket,
  Package,
  PackageOpen,
  PackageCheck,
  Barcode,
  Tags,
  Percent,
  BadgePercent,
  Lock,
  LockOpen,
  Unlock,
  Key,
  KeyRound,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldOff,
  Fingerprint,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Vehicles & Transport, Health & Medical, Emotions, Shopping, and Security. */
export const TRANSPORT_HEALTH_ICONS: Record<string, IconInfo> = {
  // Vehicles & Transport
  Car: { component: Car, keywords: ['車', '自動車', 'ドライブ', '移動'] },
  CarFront: {
    component: CarFront,
    keywords: ['車', '自動車', '正面', 'ドライブ'],
  },
  Bus: { component: Bus, keywords: ['バス', '公共交通', '通勤', '移動'] },
  Train: { component: Train, keywords: ['電車', '鉄道', '通勤', '旅行'] },
  TramFront: {
    component: TramFront,
    keywords: ['電車', '路面電車', 'トラム', '交通'],
  },
  Ship: { component: Ship, keywords: ['船', 'フェリー', '海', '旅行'] },
  Sailboat: {
    component: Sailboat,
    keywords: ['ヨット', '帆船', 'セーリング', '海'],
  },
  Plane: {
    component: Plane,
    keywords: ['飛行機', '旅行', '空港', 'フライト', '海外'],
  },
  PlaneTakeoff: {
    component: PlaneTakeoff,
    keywords: ['離陸', '出発', '飛行機', '旅行'],
  },
  PlaneLanding: {
    component: PlaneLanding,
    keywords: ['着陸', '到着', '飛行機', '帰国'],
  },
  Rocket: {
    component: Rocket,
    keywords: ['ロケット', '宇宙', 'スタートアップ', '発射', '成長'],
  },
  Fuel: {
    component: Fuel,
    keywords: ['燃料', 'ガソリン', '給油', 'エネルギー'],
  },
  ParkingCircle: {
    component: ParkingCircle,
    keywords: ['駐車場', 'パーキング', 'P', '車'],
  },
  TrafficCone: {
    component: TrafficCone,
    keywords: ['コーン', '工事', '注意', '交通'],
  },

  // Health & Medical
  Activity: {
    component: Activity,
    keywords: ['アクティビティ', '活動', '心拍', '健康'],
  },
  HeartPulse: {
    component: HeartPulse,
    keywords: ['心拍', '脈拍', '健康', '心臓'],
  },
  Stethoscope: {
    component: Stethoscope,
    keywords: ['聴診器', '医者', '診察', '病院'],
  },
  Pill: { component: Pill, keywords: ['薬', '錠剤', '医療', '治療'] },
  Syringe: {
    component: Syringe,
    keywords: ['注射', 'ワクチン', '医療', '病院'],
  },
  Bandage: { component: Bandage, keywords: ['包帯', '絆創膏', '怪我', '治療'] },
  Cross: { component: Cross, keywords: ['十字', '医療', '病院', '救急'] },
  Hospital: { component: Hospital, keywords: ['病院', '医療', '入院', '治療'] },
  Ambulance: {
    component: Ambulance,
    keywords: ['救急車', '緊急', '病院', '医療'],
  },
  Baby: { component: Baby, keywords: ['赤ちゃん', 'ベビー', '子供', '育児'] },
  Brain: {
    component: Brain,
    keywords: ['脳', '頭脳', '思考', '知識', 'アイデア'],
  },
  Bone: { component: Bone, keywords: ['骨', 'ボーン', '医療', '健康'] },
  Ear: { component: Ear, keywords: ['耳', '聞く', 'リスニング', '聴覚'] },
  HandMetal: {
    component: HandMetal,
    keywords: ['ロック', '手', 'ジェスチャー', 'サイン'],
  },

  // Emotions & Expressions
  Smile: {
    component: Smile,
    keywords: ['笑顔', 'スマイル', '幸せ', '嬉しい', '顔'],
  },
  Frown: { component: Frown, keywords: ['悲しい', 'しかめっ面', '不満', '顔'] },
  Meh: { component: Meh, keywords: ['普通', '無表情', 'どちらでもない', '顔'] },
  Angry: { component: Angry, keywords: ['怒り', '怒る', '不満', '顔'] },
  Laugh: { component: Laugh, keywords: ['笑う', '大笑い', '面白い', '顔'] },
  SmilePlus: {
    component: SmilePlus,
    keywords: ['笑顔追加', 'ポジティブ', '嬉しい'],
  },
  Annoyed: {
    component: Annoyed,
    keywords: ['イライラ', '困った', '不満', '顔'],
  },

  // Shopping
  ShoppingCart: {
    component: ShoppingCart,
    keywords: ['ショッピングカート', '買い物', 'カート', 'EC'],
  },
  ShoppingBag: {
    component: ShoppingBag,
    keywords: ['ショッピングバッグ', '買い物袋', '購入'],
  },
  ShoppingBasket: {
    component: ShoppingBasket,
    keywords: ['買い物かご', 'バスケット', 'ショッピング'],
  },
  Package: {
    component: Package,
    keywords: ['パッケージ', '荷物', '配送', '箱', '梱包'],
  },
  PackageOpen: {
    component: PackageOpen,
    keywords: ['開封', '荷物', '配送', '届いた'],
  },
  PackageCheck: {
    component: PackageCheck,
    keywords: ['配送完了', '荷物', '届いた', '確認'],
  },
  Barcode: {
    component: Barcode,
    keywords: ['バーコード', '商品', 'スキャン', '価格'],
  },
  Tags: { component: Tags, keywords: ['タグ', 'ラベル', '値札', '複数'] },
  Percent: {
    component: Percent,
    keywords: ['パーセント', '割引', 'セール', '率'],
  },
  BadgePercent: {
    component: BadgePercent,
    keywords: ['割引', 'セール', 'クーポン', 'お得'],
  },

  // Security
  Lock: {
    component: Lock,
    keywords: ['ロック', '鍵', '施錠', 'セキュリティ', '保護'],
  },
  LockOpen: {
    component: LockOpen,
    keywords: ['開錠', '解除', 'アンロック', '開く'],
  },
  Unlock: {
    component: Unlock,
    keywords: ['アンロック', '解錠', '開く', '解除'],
  },
  Key: { component: Key, keywords: ['鍵', 'キー', 'パスワード', '認証'] },
  KeyRound: { component: KeyRound, keywords: ['鍵', 'キー', '丸い', '認証'] },
  Shield: {
    component: Shield,
    keywords: ['シールド', '盾', '保護', 'セキュリティ', '防御'],
  },
  ShieldCheck: {
    component: ShieldCheck,
    keywords: ['保護済み', 'セキュリティOK', '安全'],
  },
  ShieldAlert: {
    component: ShieldAlert,
    keywords: ['警告', 'セキュリティ警告', '注意'],
  },
  ShieldOff: {
    component: ShieldOff,
    keywords: ['保護なし', 'セキュリティオフ', '危険'],
  },
  Fingerprint: {
    component: Fingerprint,
    keywords: ['指紋', '認証', '生体認証', 'セキュリティ'],
  },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
