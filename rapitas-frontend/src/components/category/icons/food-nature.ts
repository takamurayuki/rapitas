/**
 * food-nature
 *
 * Icon registry entries for Food & Drinks, Nature & Weather, and Animals categories.
 * Part of the split icon registry — see index.ts for the full ICON_DATA export.
 */

import {
  Coffee,
  CupSoda,
  Wine,
  Beer,
  Martini,
  UtensilsCrossed,
  Utensils,
  ChefHat,
  Pizza,
  Sandwich,
  Salad,
  Soup,
  Popcorn,
  Croissant,
  Cake,
  IceCream,
  Cookie,
  Candy,
  Apple,
  Cherry,
  Citrus,
  Banana,
  Carrot,
  Egg,
  Sun,
  Moon,
  CloudSun,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Snowflake,
  Wind,
  Tornado,
  Rainbow,
  Umbrella,
  Thermometer,
  Droplet,
  Droplets,
  Waves,
  Mountain,
  MountainSnow,
  Trees,
  TreePine,
  TreeDeciduous,
  Flower,
  Flower2,
  Leaf,
  Clover,
  Shrub,
  Sprout,
  Bird,
  Cat,
  Dog,
  Fish,
  Rabbit,
  Turtle,
  Snail,
  Squirrel,
  PawPrint,
  Feather,
  Shell,
  type LucideIcon,
} from 'lucide-react';

import type { IconInfo } from '../icon-registry';

/** Icon entries for Food & Drinks, Nature & Weather, and Animals. */
export const FOOD_NATURE_ICONS: Record<string, IconInfo> = {
  // Food & Drinks
  Coffee: {
    component: Coffee,
    keywords: ['コーヒー', 'カフェ', '飲み物', '休憩', '朝'],
  },
  CupSoda: {
    component: CupSoda,
    keywords: ['ソーダ', 'ジュース', '飲み物', 'コップ'],
  },
  Wine: { component: Wine, keywords: ['ワイン', 'お酒', 'グラス', 'ディナー'] },
  Beer: { component: Beer, keywords: ['ビール', 'お酒', '乾杯', '居酒屋'] },
  Martini: {
    component: Martini,
    keywords: ['マティーニ', 'カクテル', 'お酒', 'バー'],
  },
  UtensilsCrossed: {
    component: UtensilsCrossed,
    keywords: ['食事', 'レストラン', 'カトラリー', 'フォークナイフ'],
  },
  Utensils: {
    component: Utensils,
    keywords: ['カトラリー', '食器', '食事', 'フォーク', 'スプーン'],
  },
  ChefHat: {
    component: ChefHat,
    keywords: ['シェフ', '料理人', '調理', 'コック帽'],
  },
  Pizza: {
    component: Pizza,
    keywords: ['ピザ', 'ピッツァ', '食べ物', 'イタリアン'],
  },
  Sandwich: {
    component: Sandwich,
    keywords: ['サンドイッチ', 'パン', 'ランチ', '軽食'],
  },
  Salad: { component: Salad, keywords: ['サラダ', '野菜', 'ヘルシー', '健康'] },
  Soup: { component: Soup, keywords: ['スープ', '汁物', '温かい', '料理'] },
  Popcorn: {
    component: Popcorn,
    keywords: ['ポップコーン', '映画', 'スナック', 'おやつ'],
  },
  Croissant: {
    component: Croissant,
    keywords: ['クロワッサン', 'パン', '朝食', 'フランス'],
  },
  Cake: {
    component: Cake,
    keywords: ['ケーキ', 'お祝い', '誕生日', 'スイーツ', 'デザート'],
  },
  IceCream: {
    component: IceCream,
    keywords: ['アイスクリーム', 'アイス', 'デザート', '冷たい'],
  },
  Cookie: {
    component: Cookie,
    keywords: ['クッキー', 'ビスケット', 'お菓子', 'おやつ'],
  },
  Candy: {
    component: Candy,
    keywords: ['キャンディ', '飴', 'お菓子', 'スイーツ'],
  },
  Apple: {
    component: Apple,
    keywords: ['りんご', 'アップル', '果物', 'フルーツ', '健康'],
  },
  Cherry: {
    component: Cherry,
    keywords: ['さくらんぼ', 'チェリー', '果物', 'フルーツ'],
  },
  Citrus: {
    component: Citrus,
    keywords: ['柑橘', 'オレンジ', 'レモン', '果物'],
  },
  Banana: {
    component: Banana,
    keywords: ['バナナ', '果物', 'フルーツ', '黄色'],
  },
  Carrot: {
    component: Carrot,
    keywords: ['にんじん', '野菜', 'オレンジ', '健康'],
  },
  Egg: { component: Egg, keywords: ['卵', 'たまご', 'エッグ', '朝食'] },

  // Nature & Weather
  Sun: {
    component: Sun,
    keywords: ['太陽', '晴れ', '日', '明るい', '昼', 'ライト'],
  },
  Moon: { component: Moon, keywords: ['月', '夜', '暗い', 'ダーク', '睡眠'] },
  CloudSun: {
    component: CloudSun,
    keywords: ['曇りのち晴れ', '天気', '雲', '太陽'],
  },
  CloudMoon: {
    component: CloudMoon,
    keywords: ['曇り', '夜', '天気', '雲', '月'],
  },
  CloudRain: {
    component: CloudRain,
    keywords: ['雨', '天気', '雲', '梅雨', '傘'],
  },
  CloudSnow: { component: CloudSnow, keywords: ['雪', '天気', '冬', '寒い'] },
  CloudLightning: {
    component: CloudLightning,
    keywords: ['雷', '嵐', '天気', '稲妻'],
  },
  Snowflake: {
    component: Snowflake,
    keywords: ['雪', '結晶', '冬', '寒い', 'クリスマス'],
  },
  Wind: { component: Wind, keywords: ['風', 'そよ風', '天気', '空気'] },
  Tornado: { component: Tornado, keywords: ['竜巻', '嵐', '天気', '災害'] },
  Rainbow: {
    component: Rainbow,
    keywords: ['虹', 'レインボー', 'カラフル', '天気'],
  },
  Umbrella: { component: Umbrella, keywords: ['傘', '雨', '天気', '梅雨'] },
  Thermometer: {
    component: Thermometer,
    keywords: ['温度計', '気温', '体温', '温度'],
  },
  Droplet: { component: Droplet, keywords: ['水滴', '雫', '水', '雨'] },
  Droplets: { component: Droplets, keywords: ['水滴', '雫', '水', '湿度'] },
  Waves: { component: Waves, keywords: ['波', '海', '水', 'オーシャン'] },
  Mountain: {
    component: Mountain,
    keywords: ['山', '登山', '自然', 'アウトドア', 'ハイキング'],
  },
  MountainSnow: {
    component: MountainSnow,
    keywords: ['雪山', '冬山', 'スキー', 'アルプス'],
  },
  Trees: { component: Trees, keywords: ['木', '森', '自然', '緑', '公園'] },
  TreePine: {
    component: TreePine,
    keywords: ['松', '針葉樹', 'クリスマス', '森'],
  },
  TreeDeciduous: {
    component: TreeDeciduous,
    keywords: ['木', '落葉樹', '森', '自然'],
  },
  Flower: {
    component: Flower,
    keywords: ['花', 'フラワー', '植物', 'ガーデニング'],
  },
  Flower2: {
    component: Flower2,
    keywords: ['花', 'フラワー', '植物', 'ガーデニング', 'チューリップ'],
  },
  Leaf: { component: Leaf, keywords: ['葉', 'リーフ', '植物', '自然', 'エコ'] },
  Clover: {
    component: Clover,
    keywords: ['クローバー', '四つ葉', '幸運', 'ラッキー'],
  },
  Shrub: { component: Shrub, keywords: ['低木', '植物', '庭', 'ガーデン'] },
  Sprout: {
    component: Sprout,
    keywords: ['芽', '新芽', '成長', 'スタート', '新しい'],
  },

  // Animals
  Bird: { component: Bird, keywords: ['鳥', '小鳥', 'ツイート', '飛ぶ'] },
  Cat: {
    component: Cat,
    keywords: ['猫', 'ネコ', 'ペット', '動物', 'かわいい'],
  },
  Dog: { component: Dog, keywords: ['犬', 'イヌ', 'ペット', '動物', 'わんこ'] },
  Fish: { component: Fish, keywords: ['魚', 'さかな', '水族館', '海', '釣り'] },
  Rabbit: {
    component: Rabbit,
    keywords: ['うさぎ', 'ラビット', 'ペット', '動物'],
  },
  Turtle: { component: Turtle, keywords: ['カメ', '亀', '動物', 'ゆっくり'] },
  Snail: {
    component: Snail,
    keywords: ['カタツムリ', 'でんでん虫', '遅い', 'ゆっくり'],
  },
  Squirrel: {
    component: Squirrel,
    keywords: ['リス', '動物', 'かわいい', '森'],
  },
  PawPrint: {
    component: PawPrint,
    keywords: ['肉球', '足跡', 'ペット', '動物'],
  },
  Feather: { component: Feather, keywords: ['羽', 'フェザー', '軽い', '鳥'] },
  Shell: { component: Shell, keywords: ['貝殻', 'シェル', '海', 'ビーチ'] },
};

// NOTE: LucideIcon is imported only to satisfy the type constraint on IconInfo.
export type { LucideIcon };
