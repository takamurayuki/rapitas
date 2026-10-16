/**
 * rank-fusion
 *
 * Reciprocal Rank Fusion (RRF) of the vector and lexical recall channels.
 * Cosine similarity and bigram coverage live on incomparable scales, so the
 * channels are merged by RANK only — no cross-channel score calibration is
 * needed and the merge is fully deterministic (ties break on id ascending).
 */

/** One fused candidate with its per-channel ranks (1-based, null = absent). */
export interface FusedRank {
  id: number;
  /** Σ 1 / (k + rank) over the channels the id appeared in. */
  fused: number;
  vectorRank: number | null;
  lexicalRank: number | null;
}

/** RRF smoothing constant from the original paper; larger = flatter rank curve. */
export const DEFAULT_RRF_K = 60;

/**
 * Fuse two ranked id lists with RRF.
 *
 * @param vectorIds - Ids in vector-channel rank order. / ベクトル順位のID列
 * @param lexicalIds - Ids in lexical-channel rank order. / 語彙順位のID列
 * @param k - RRF constant. / RRF定数
 * @returns Candidates sorted by fused score desc, then id asc. / 統合順位
 */
export function fuseRankings(
  vectorIds: number[],
  lexicalIds: number[],
  k = DEFAULT_RRF_K,
): FusedRank[] {
  const byId = new Map<number, FusedRank>();
  const take = (ids: number[], channel: 'vectorRank' | 'lexicalRank') => {
    ids.forEach((id, i) => {
      const rank = i + 1;
      const cur = byId.get(id) ?? { id, fused: 0, vectorRank: null, lexicalRank: null };
      // First occurrence wins if a channel lists an id twice (defensive).
      if (cur[channel] !== null) return;
      cur[channel] = rank;
      cur.fused += 1 / (k + rank);
      byId.set(id, cur);
    });
  };
  take(vectorIds, 'vectorRank');
  take(lexicalIds, 'lexicalRank');
  return [...byId.values()].sort((a, b) => b.fused - a.fused || a.id - b.id);
}
