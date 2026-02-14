/**
 * リンクをドメイン別にグループ化するユーティリティ
 */
import type { FavoriteLink } from '@/types/favorite-link';

export interface DomainGroup {
  domain: string;
  displayName: string;
  links: FavoriteLink[];
  totalVisitCount: number;
}

/**
 * URLからドメインを抽出
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    // www. プレフィックスを除去して統一
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    // URLパースに失敗した場合は元のURLを返す
    return url;
  }
}

/**
 * ドメインの表示名を取得
 */
export function getDomainDisplayName(domain: string): string {
  // 一般的なドメインの表示名マッピング
  const domainNames: Record<string, string> = {
    'github.com': 'GitHub',
    'stackoverflow.com': 'Stack Overflow',
    'developer.mozilla.org': 'MDN',
    'docs.microsoft.com': 'Microsoft Docs',
    'npmjs.com': 'npm',
    'youtube.com': 'YouTube',
    'twitter.com': 'Twitter',
    'x.com': 'X (Twitter)',
    'google.com': 'Google',
    'qiita.com': 'Qiita',
    'zenn.dev': 'Zenn',
  };

  return domainNames[domain] || domain;
}

/**
 * リンクをドメイン別にグループ化
 */
export function groupLinksByDomain(links: FavoriteLink[]): DomainGroup[] {
  const groups = new Map<string, DomainGroup>();

  links.forEach((link) => {
    const domain = extractDomain(link.url);

    if (!groups.has(domain)) {
      groups.set(domain, {
        domain,
        displayName: getDomainDisplayName(domain),
        links: [],
        totalVisitCount: 0,
      });
    }

    const group = groups.get(domain)!;
    group.links.push(link);
    group.totalVisitCount += link.visitCount;
  });

  // グループ内のリンクを訪問回数順にソート
  groups.forEach((group) => {
    group.links.sort((a, b) => b.visitCount - a.visitCount);
  });

  // グループを総訪問回数順にソート
  return Array.from(groups.values()).sort(
    (a, b) => b.totalVisitCount - a.totalVisitCount
  );
}

/**
 * リンクが属するドメイングループのインデックスを取得
 */
export function getDomainGroupIndex(link: FavoriteLink, groups: DomainGroup[]): number {
  const linkDomain = extractDomain(link.url);
  return groups.findIndex((group) => group.domain === linkDomain);
}