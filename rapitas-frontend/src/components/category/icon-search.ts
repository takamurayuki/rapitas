import type { LucideIcon } from 'lucide-react';
import { ICON_DATA } from './icon-registry';

// Array of all available icon names
export const ICON_NAMES = Object.keys(ICON_DATA);

// Get icon component by name
export const getIconComponent = (name: string): LucideIcon | undefined => {
  return ICON_DATA[name]?.component;
};

// Build search index (executed once on first use)
const createSearchIndex = () => {
  const index = new Map<string, Set<string>>();

  ICON_NAMES.forEach((name) => {
    const iconInfo = ICON_DATA[name];
    const lowerName = name.toLowerCase();

    // N-gram index for English names (2-3 chars)
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

    // Japanese keyword index
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

// Search index (lazily initialized)
let searchIndex: Map<string, Set<string>> | null = null;

// Search icons (supports both Japanese and English queries)
export const searchIcons = (query: string): string[] => {
  if (!query.trim()) {
    return ICON_NAMES;
  }

  // Lazy initialization of index
  if (!searchIndex) {
    searchIndex = createSearchIndex();
  }

  const lowerQuery = query.toLowerCase();
  const resultSet = new Set<string>();

  // For short queries, use linear search
  if (query.length <= 2) {
    return ICON_NAMES.filter((name) => {
      if (name.toLowerCase().includes(lowerQuery)) return true;
      const iconInfo = ICON_DATA[name];
      return iconInfo?.keywords.some((keyword) => keyword.includes(query));
    });
  }

  // Index-based search
  if (searchIndex.has(query)) {
    searchIndex.get(query)!.forEach((name) => resultSet.add(name));
  }

  if (searchIndex.has(lowerQuery)) {
    searchIndex.get(lowerQuery)!.forEach((name) => resultSet.add(name));
  }

  // Also check partial matches
  ICON_NAMES.forEach((name) => {
    if (name.toLowerCase().includes(lowerQuery)) {
      resultSet.add(name);
    }
  });

  return Array.from(resultSet);
};
