/**
 * concern-search-service
 *
 * Executes a parsed voice/text query against the concern backlog and shapes the
 * scored JSON hits. Reuses listConcerns and filters in the application layer so
 * no DB-specific SQL is needed (SQLite and PostgreSQL behave the same).
 */
import { listConcerns } from './concern-backlog-service';
import { parseConcernQuery, type ParsedConcernQuery } from './concern-search-parser';
import { toSearchItem, type ConcernSearchItem } from './concern-search-score';

const PAGE_SIZE = 100;
// Safety valve against unbounded scans; the backlog is expected to stay far below this.
const MAX_SCAN = 5000;

export interface ConcernSearchResponse {
  items: ConcernSearchItem[];
  total: number;
  parsed: ParsedConcernQuery;
}

/**
 * Searches concerns by a free-text/voice query.
 *
 * @param params - Query text, optional explicit type/status and paging / クエリと絞り込み・ページング
 * @returns Scored hits, total match count and the parsed query / 検索結果・総数・解析結果
 */
export async function searchConcerns(params: {
  q?: string;
  type?: 'bug' | 'refactor' | 'security' | 'perf' | 'other';
  status?: 'open' | 'task_created' | 'dismissed' | 'resolved' | 'all';
  limit?: number;
  offset?: number;
}): Promise<ConcernSearchResponse> {
  const parsed = parseConcernQuery(params.q ?? '');
  const type = params.type ?? parsed.type ?? 'perf';
  const limit = params.limit && params.limit > 0 ? params.limit : 20;
  const offset = params.offset && params.offset > 0 ? params.offset : 0;

  const matches: ConcernSearchItem[] = [];
  for (let scanned = 0; scanned < MAX_SCAN; scanned += PAGE_SIZE) {
    const page = await listConcerns({
      status: params.status ?? 'open',
      type,
      limit: PAGE_SIZE,
      offset: scanned,
    });
    for (const c of page.concerns) {
      if (parsed.severities.length > 0 && !parsed.severities.includes(c.severity)) continue;
      const haystack = `${c.title} ${c.detail} ${c.location ?? ''}`.toLowerCase();
      if (!parsed.keywords.every((k) => haystack.includes(k))) continue;
      matches.push(toSearchItem(c));
    }
    if (page.concerns.length < PAGE_SIZE || scanned + PAGE_SIZE >= page.total) break;
  }

  return { items: matches.slice(offset, offset + limit), total: matches.length, parsed };
}
