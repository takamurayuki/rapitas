/**
 * candidates
 *
 * The prompt and the parser for turning the user's own words about what they
 * want to build into selectable options.
 *
 * Why this exists. generate-proposals already forbids 「ありふれたジャンル」 in
 * its prompt, yet its proposals converge — because its entire input is six
 * categorical values drawn from fixed catalogs (12 genres, per-genre
 * sub-genres, 20 elements). Reported 2026-10-12: 「現在のアプリのテーマや機能は
 * 全て固定の選択肢となっているので独創的なアプリが生まれない」. Generating the
 * OPTIONS from the user's sentence removes that ceiling while keeping the
 * interaction a card pick.
 *
 * Not responsible for calling the model or for merging into the catalog — the
 * route owns the first, useOptionCatalog.mergeProposed the second.
 */

/** One proposed option, shaped like the wizard's DynamicItem. */
export interface OptionCandidate {
  id: string;
  label: string;
  /** Why this option suits the concept, shown as a tooltip. / 提案理由 */
  reason?: string;
}

/** Which list the candidates are for. */
export type CandidateLevel = 'genre' | 'subs' | 'elements';

/** How many candidates to request and to keep per level. */
export const MAX_CANDIDATES = 4;

/** Longest concept text sent to the model, so a paste cannot blow the prompt. */
export const MAX_CONCEPT_CHARS = 600;

const LEVEL_BRIEF: Record<CandidateLevel, string> = {
  genre:
    'このアプリが属する「領域」の候補。既存の12分類（ゲーム/SNS/EC/SaaS/メディア/健康/金融/教育/AIツール/クリエイティブ/地図/ユーティリティ）に当てはめようとせず、' +
    'この題材そのものを言い表す領域名を提案すること。既存分類の言い換えは不可。',
  subs: 'この領域の中での「切り口」の候補。同じ題材でも狙いが変わると別のアプリになる、その分岐を示すこと。',
  elements:
    'この題材を成立させるために効く「機能要素」の候補。汎用機能（認証・通知・ダークモード等）は既に定番側にあるので挙げず、' +
    'この題材でなければ出てこないものを挙げること。',
};

/**
 * Build the system prompt for one level.
 *
 * @param level - Which list the candidates are for / 対象のリスト
 * @returns System prompt / システムプロンプト
 */
export function buildCandidatePrompt(level: CandidateLevel): string {
  return `あなたはプロダクトの構想を具体的な選択肢に落とす設計者です。
ユーザーが書いた「作りたいもの」から、${LEVEL_BRIEF[level]}

## 出力形式（JSONのみ・説明文不要）
{
  "candidates": [
    { "id": "英小文字とアンダースコアのみの短い識別子", "label": "画面に出す短い名前(全角12字以内)", "reason": "この題材に効く理由(40字以内)" }
  ]
}

## 制約
- ${MAX_CANDIDATES} 件以内。無理に数を揃えず、題材から自然に出るものだけを挙げる。
- label は選択肢のカードに収まる長さにする。文章にしない。
- ユーザーの言葉を言い換えただけの選択肢は挙げない（選ぶ意味がない）。
- 題材から離れた一般論は挙げない。`;
}

/**
 * Prefix every proposed id carries.
 *
 * Two jobs: a proposal can never collide with a static catalog id and silently
 * replace a built-in option, and the screens can tell the two sources apart to
 * render them under separate headings while keeping one selection list.
 */
export const PROPOSED_ID_PREFIX = 'ai_';

/** Keeps ids usable as React keys and as catalog ids. */
function normalizeId(raw: unknown, index: number): string {
  const s = typeof raw === 'string' ? raw.toLowerCase().replace(/[^a-z0-9_]/g, '_') : '';
  const trimmed = s.replace(/^_+|_+$/g, '').slice(0, 40);
  return `${PROPOSED_ID_PREFIX}${trimmed || `cand${index + 1}`}`;
}

/**
 * Parse the model's reply into candidates.
 *
 * Degrades to `[]` on anything unexpected: the wizard shows the static catalog
 * in that case, so a bad reply must never be worth failing the request over.
 *
 * @param raw - Raw model text, possibly fenced / モデルの生応答
 * @returns Candidates, capped and de-duplicated / 候補（上限・重複排除済み）
 */
export function parseCandidates(raw: string): OptionCandidate[] {
  const text = typeof raw === 'string' ? raw : '';
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const jsonish = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  if (!jsonish.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonish);
  } catch {
    return [];
  }

  const list = (parsed as { candidates?: unknown })?.candidates;
  if (!Array.isArray(list)) return [];

  const out: OptionCandidate[] = [];
  const seen = new Set<string>();
  for (const [i, item] of list.entries()) {
    if (out.length >= MAX_CANDIDATES) break;
    const label =
      typeof (item as { label?: unknown })?.label === 'string'
        ? (item as { label: string }).label.trim()
        : '';
    if (!label) continue;
    const id = normalizeId((item as { id?: unknown })?.id, i);
    if (seen.has(id) || seen.has(label)) continue;
    seen.add(id);
    seen.add(label);
    const reason = (item as { reason?: unknown })?.reason;
    out.push({
      id,
      label,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : undefined,
    });
  }
  return out;
}

/**
 * Trim the concept to what is worth sending.
 *
 * @param concept - The user's own words / ユーザーが書いた題材
 * @returns Trimmed text, or '' when there is nothing to work from / 送る文字列
 */
export function normalizeConcept(concept: string | null | undefined): string {
  return (concept ?? '').trim().slice(0, MAX_CONCEPT_CHARS);
}
