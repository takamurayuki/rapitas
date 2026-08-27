/**
 * Workflow Memory Render
 *
 * Pure rendering / ranking helpers for the recalled-knowledge prompt section:
 * outcome weighting and the markdown formatter (with stage and channel
 * markers so agents treat dormant / archived knowledge critically). Split out
 * of workflow-memory-context.ts, which owns the I/O (search, outcomes, episodes).
 */

/** Per-entry content snippet length fed to the model. */
const SNIPPET_LEN = 400;

/** The outcome of the task an entry was learned from. */
export type EntryOutcome = 'first_try' | 'completed' | 'blocked';

/** A knowledge entry shaped for rendering. */
/** Observations required before an entry's recall record affects its rank. */
export const USEFULNESS_MIN_OBSERVATIONS = 3;

export interface MemoryEntry {
  /** KnowledgeEntry id — rendered as K-<id> so agents can declare usage (R8). */
  id: number;
  title: string;
  content: string;
  category: string;
  similarity: number;
  /** Source task the entry was learned from (null when unknown). */
  sourceTaskId?: number | null;
  /** Outcome of that source task — drives ranking weight and the label. */
  outcome?: EntryOutcome | null;
  /** KB validation state — labels contested (conflict) knowledge as uncertain. */
  validationStatus?: string;
  /** Forgetting stage — dormant / archived get an explicit "verify" marker. */
  forgettingStage?: string;
  /** Recall channel that surfaced the entry. */
  channel?: 'vector' | 'lexical' | 'both';
  /** Lexical coverage (0..1) — shown as relevance for lexical-only hits. */
  lexicalScore?: number | null;
}

/** Recall ranking weight by source-task outcome. */
const OUTCOME_MULTIPLIER: Record<EntryOutcome, number> = {
  first_try: 1.2,
  completed: 1.05,
  // Kept (a failure is a lesson) but ranked lower so proven knowledge leads.
  blocked: 0.7,
};

export const TEXT = {
  ja: {
    header: '# 過去の知見（記憶からの参照 — 同じ轍を踏まないこと）',
    lead: '以下は過去のタスク・懸念・教訓から、本タスクに関連性が高い順に抽出した知見です。調査・実装の前提として活用し、既知の失敗や設計判断を繰り返さないでください。',
    relevance: '関連度',
    outcome: {
      first_try: '✅ 初回成功の知見',
      completed: '☑ 完了タスクの知見',
      blocked: '⚠️ 前回ブロック（失敗の教訓 — 同じ轍を避ける）',
    } as Record<EntryOutcome, string>,
    conflict: ' — ⚠️ 矛盾あり・要検証',
    stage: {
      dormant: ' — 休眠中の知見（要検証）',
      archived: ' — アーカイブ済みの知見（古い可能性・要検証）',
    } as Record<string, string>,
    usageDeclaration:
      '### 使用申告（必須 — R8 学習ループ用）\n作業の最終出力（verify.md など、このフェーズで保存する .md）の末尾に `## 使用知識` セクションを設け、上記の知見のうち**実際に判断・実装に使ったもの**だけを `- K-<番号>` 形式で列挙してください。内容が誤っていた・現状と矛盾していた知見は `- K-<番号>: 誤り — <簡潔な理由>` と記してください。使わなかった知見は書かないこと（列挙が正確なほど、次回以降の想起品質が上がります）。',
  },
  en: {
    header: '# Prior Knowledge (recalled from memory — do not repeat past mistakes)',
    lead: 'The following are the most relevant lessons, concerns, and task patterns from past work. Use them as context for research/implementation and avoid repeating known failures or re-deciding settled design points.',
    relevance: 'relevance',
    outcome: {
      first_try: '✅ from a first-try success',
      completed: '☑ from a completed task',
      blocked: '⚠️ previously BLOCKED (failure lesson — avoid repeating)',
    } as Record<EntryOutcome, string>,
    conflict: ' — ⚠️ contested, verify',
    stage: {
      dormant: ' — dormant, verify',
      archived: ' — archived, may be stale',
    } as Record<string, string>,
    usageDeclaration:
      '### Usage declaration (REQUIRED — feeds the learning loop)\nAt the end of the final .md you save for this phase (e.g. verify.md), add a `## 使用知識` section listing ONLY the entries you actually used, one per line as `- K-<id>`. If an entry was WRONG or contradicted reality, write `- K-<id>: 誤り — <short reason>`. Do not list unused entries.',
  },
} as const;

/**
 * Apply outcome weighting: attach each entry's outcome and re-sort by the
 * outcome-adjusted score. Pure — the testable core of the ranking change.
 *
 * @param entries - Entries with raw similarity + sourceTaskId. / 類似度付きエントリ
 * @param outcomeByTaskId - Map of source taskId → outcome. / タスク別アウトカム
 * @returns Entries with `outcome` set, sorted by adjusted score. / 重み付け後の並び
 */
/**
 * How much an entry's own recall record moves its rank.
 *
 * The outcome weight above says the entry came from a task that went well. This
 * says the entry has actually been USED when put in front of an agent — the
 * causal question, and the one the recall decisions settle.
 *
 * Deliberately gentle, and deliberately silent on thin evidence: an entry with
 * no record is NOT a useless entry, it is a new one, so absence must never be
 * read as a low score. Below the observation floor the multiplier is exactly 1.
 *
 * @param u - The entry's record, if it has one. / 実績（あれば）
 * @returns A multiplier in [0.7, 1.3]. / 乗数
 */
function usefulnessMultiplier(u?: { injected: number; used: number; rate: number }): number {
  if (!u || u.injected < USEFULNESS_MIN_OBSERVATIONS) return 1;
  // rate 0 → 0.7 (repeatedly offered, never used), rate 1 → 1.3.
  return 0.7 + 0.6 * u.rate;
}

export function applyOutcomeWeighting(
  entries: MemoryEntry[],
  outcomeByTaskId: Map<number, EntryOutcome>,
  usefulness?: Map<number, { injected: number; used: number; rate: number }>,
): MemoryEntry[] {
  return (
    entries
      .map((e) => {
        const outcome =
          e.sourceTaskId != null ? (outcomeByTaskId.get(e.sourceTaskId) ?? null) : null;
        // Lexical-only hits carry similarity 0; use their coverage score so the
        // outcome weighting still has a magnitude to act on.
        const base = e.similarity > 0 ? e.similarity : (e.lexicalScore ?? 0);
        return {
          entry: { ...e, outcome },
          score:
            base *
            (outcome ? OUTCOME_MULTIPLIER[outcome] : 1) *
            usefulnessMultiplier(usefulness?.get(e.id)),
        };
      })
      // Tie-break on title then content: MemoryEntry has no id, and two entries
      // can land on an identical outcome-adjusted score (e.g. equal similarity +
      // same outcome weight). Array#sort is not guaranteed stable across engines,
      // so pin the tie order to the entry text to keep the injected prompt slice
      // identical across repeated runs of the same query.
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.entry.title.localeCompare(b.entry.title) ||
          a.entry.content.localeCompare(b.entry.content),
      )
      .map((x) => x.entry)
  );
}

/**
 * Render retrieved entries as a markdown prompt section. Pure — the testable core.
 *
 * @param entries - Relevant knowledge entries (already ranked). / 関連知見（順位済み）
 * @param language - Output language. / 出力言語
 * @returns The markdown section, or '' when there is nothing to inject. / 注入する節（無ければ空文字）
 */
export function renderMemorySection(entries: MemoryEntry[], language: 'ja' | 'en'): string {
  if (entries.length === 0) return '';
  const t = TEXT[language];
  const items = entries
    .map((e) => {
      // Lexical-only hits have no cosine; show their coverage score instead of "0%".
      const relevance = e.channel === 'lexical' ? (e.lexicalScore ?? 0) : e.similarity;
      const pct = Math.round(relevance * 100);
      const outcomeMark = e.outcome ? ` — ${t.outcome[e.outcome]}` : '';
      // Flag contested knowledge so the agent weighs it critically instead of
      // treating a 1-of-a-contradicting-pair entry as settled fact.
      const conflictMark = e.validationStatus === 'conflict' ? t.conflict : '';
      // Dormant / archived entries are recalled again (they used to be invisible)
      // but must be read as "possibly stale" rather than settled fact.
      const stageMark = e.forgettingStage ? (t.stage[e.forgettingStage] ?? '') : '';
      const marker = `${outcomeMark}${conflictMark}${stageMark}`;
      const snippet =
        e.content.length > SNIPPET_LEN ? `${e.content.slice(0, SNIPPET_LEN)}…` : e.content;
      return `## K-${e.id} [${e.category}] ${e.title} (${t.relevance} ${pct}%)${marker}\n${snippet}`;
    })
    .join('\n\n');
  return `${t.header}\n\n${t.lead}\n\n${items}\n\n${t.usageDeclaration}`;
}
