'use client';
// use-concept-candidates

import { useState } from 'react';
import type { DynamicItem } from '../_types/types';
import type {
  CandidateLevel,
  OptionCandidate,
} from '../../api/generate-option-candidates/candidates';

/** lucide glyph for AI-proposed options. */
// NOTE: `Sparkles` already means 「AI生成/おすすめ操作」 in ICON_POLICY, so this
// reuses an established meaning instead of claiming a new glyph.
const PROPOSED_ICON = 'Sparkles';

/** Why a level has no proposals, in the user's language. */
const REASON_TEXT: Record<string, string> = {
  timeout: 'お題からの提案は時間内に返りませんでした。',
  connection_failed: 'お題からの提案は取得できませんでした（接続エラー）。',
  server_error: 'お題からの提案は取得できませんでした（サーバーエラー）。',
  parse_failed: 'お題からの提案を読み取れませんでした。',
};

/**
 * Holds the user's concept text and the options proposed from it.
 *
 * Kept out of use-wizard, which is near the 500-line hard limit; also keeps the
 * one network concern (candidate fetching) in one place so a failure can only
 * ever thin a screen, never block it.
 *
 * @returns The concept, the proposals per level, and the actions / 題材・提案・操作
 */
export function useConceptCandidates() {
  const [concept, setConcept] = useState('');
  const [proposed, setProposed] = useState<Partial<Record<CandidateLevel, DynamicItem[]>>>({});
  const [loading, setLoading] = useState<Partial<Record<CandidateLevel, boolean>>>({});
  const [degraded, setDegraded] = useState<Partial<Record<CandidateLevel, string>>>({});

  /**
   * Fetch candidates for one level. No-op without a concept.
   *
   * Resolves to the items so a caller can merge them into its catalog; the
   * state copy is what the screens render.
   *
   * @param level - Which list to propose for / 対象のリスト
   * @param picked - Choices already made, to stay on-topic / これまでの選択
   * @returns The proposed items, or [] / 提案された項目
   */
  const fetchFor = async (
    level: CandidateLevel,
    picked?: { genre?: string; subs?: string[] },
  ): Promise<DynamicItem[]> => {
    if (!concept.trim()) return [];
    setLoading((p) => ({ ...p, [level]: true }));
    setDegraded((p) => ({ ...p, [level]: undefined }));
    try {
      const res = await fetch('/api/generate-option-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, level, picked }),
      });
      const data = (await res.json()) as { candidates?: OptionCandidate[]; errorCode?: string };
      const items: DynamicItem[] = (data.candidates ?? []).map((c) => ({
        id: c.id,
        icon: PROPOSED_ICON,
        label: c.label,
      }));
      setProposed((p) => ({ ...p, [level]: items }));
      // `no_concept` and `bad_level` are caller mistakes, not worth telling the
      // user about; the rest explain a visibly thinner screen.
      if (items.length === 0 && data.errorCode && REASON_TEXT[data.errorCode]) {
        setDegraded((p) => ({ ...p, [level]: REASON_TEXT[data.errorCode as string] }));
      }
      return items;
    } catch {
      setProposed((p) => ({ ...p, [level]: [] }));
      setDegraded((p) => ({ ...p, [level]: REASON_TEXT.connection_failed }));
      return [];
    } finally {
      setLoading((p) => ({ ...p, [level]: false }));
    }
  };

  const reset = () => {
    setConcept('');
    setProposed({});
    setLoading({});
    setDegraded({});
  };

  return {
    concept,
    setConcept,
    /** Proposals per level; undefined means "not fetched yet". / 段ごとの提案 */
    proposed,
    loading,
    degraded,
    fetchFor,
    reset,
  };
}
