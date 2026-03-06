import type { LucideIcon } from 'lucide-react';
import { ICON_DATA } from './icon-registry';

// アイコン名の配列を取得
export const ICON_NAMES = Object.keys(ICON_DATA);

// アイコンコンポーネントを取得する関数
export const getIconComponent = (name: string): LucideIcon | undefined => {
  return ICON_DATA[name]?.component;
};

// 検索用インデックスの作成（初回のみ実行）
const createSearchIndex = () => {
  const index = new Map<string, Set<string>>();

  ICON_NAMES.forEach((name) => {
    const iconInfo = ICON_DATA[name];
    const lowerName = name.toLowerCase();

    // 英語名のn-gramインデックス（2-3文字）
    for (let i = 0; i < lowerName.length - 1; i++) {
      const bigram = lowerName.slice(i, i + 2);
      if (!index.has(bigram)) index.set(bigram, new Set());
      index.get(bigram)!.add(name);

      if (i < lowerName.length - 2) {
        const trigram = lowerName.slice(i, i + 3);
        if (!index.has(trigram)) index.set(trigram, new Set());
        index.get(trigram)!.add(name);
      }
    }

    // 日本語キーワードのインデックス
    iconInfo.keywords.forEach((keyword) => {
      for (let i = 0; i < keyword.length; i++) {
        for (let j = i + 1; j <= keyword.length; j++) {
          const substr = keyword.slice(i, j);
          if (!index.has(substr)) index.set(substr, new Set());
          index.get(substr)!.add(name);
        }
      }
    });
  });

  return index;
};

// 検索インデックス（遅延初期化）
let searchIndex: Map<string, Set<string>> | null = null;

// 検索関数（日本語・英語両対応）
export const searchIcons = (query: string): string[] => {
  if (!query.trim()) {
    return ICON_NAMES;
  }

  // インデックスの遅延初期化
  if (!searchIndex) {
    searchIndex = createSearchIndex();
  }

  const lowerQuery = query.toLowerCase();
  const resultSet = new Set<string>();

  // 短いクエリの場合は通常の検索
  if (query.length <= 2) {
    return ICON_NAMES.filter((name) => {
      if (name.toLowerCase().includes(lowerQuery)) return true;
      const iconInfo = ICON_DATA[name];
      return iconInfo?.keywords.some((keyword) => keyword.includes(query));
    });
  }

  // インデックスを使用した検索
  if (searchIndex.has(query)) {
    searchIndex.get(query)!.forEach((name) => resultSet.add(name));
  }

  if (searchIndex.has(lowerQuery)) {
    searchIndex.get(lowerQuery)!.forEach((name) => resultSet.add(name));
  }

  // 部分一致も確認
  ICON_NAMES.forEach((name) => {
    if (name.toLowerCase().includes(lowerQuery)) {
      resultSet.add(name);
    }
  });

  return Array.from(resultSet);
};
