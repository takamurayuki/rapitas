/**
 * concern-search-benchmark-corpus
 *
 * 50 labelled queries (30 English, 20 Japanese) with the expected parse. Includes
 * ASR-style variation (case, missing hyphen, word order, polite suffixes) to
 * approximate post-recognition text drift. Test-support data only.
 */
import type { ParsedConcernSeverity, ParsedConcernType } from './concern-search-parser';

export interface CorpusCase {
  text: string;
  type: ParsedConcernType | undefined;
  severities: ParsedConcernSeverity[];
}

export const ENGLISH_CORPUS: CorpusCase[] = [
  { text: 'Show me PERF-related blocking concerns', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'show me perf related blocking concerns', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'Show me performance concerns', type: 'perf', severities: [] },
  { text: 'performance blocker', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'list critical performance concerns', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'find urgent perf issues', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'Show me all PERF concerns', type: 'perf', severities: [] },
  { text: 'perf concerns with high severity', type: 'perf', severities: ['high'] },
  { text: 'show high performance concerns', type: 'perf', severities: ['high'] },
  { text: 'show me low performance concerns', type: 'perf', severities: ['low'] },
  { text: 'minor perf concerns', type: 'perf', severities: ['low'] },
  { text: 'medium performance issues', type: 'perf', severities: ['medium'] },
  { text: 'please show me perf concerns', type: 'perf', severities: [] },
  { text: 'give me the blocking performance issues', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'PERFORMANCE CRITICAL', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'Perf blocking', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'get all critical perf concerns', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'search performance concerns only', type: 'perf', severities: [] },
  { text: 'show me blocking concerns', type: undefined, severities: ['urgent', 'high'] },
  { text: 'show critical concerns', type: undefined, severities: ['urgent', 'high'] },
  { text: 'list urgent issues', type: undefined, severities: ['urgent', 'high'] },
  { text: 'show me bug concerns', type: 'bug', severities: [] },
  { text: 'critical security concerns', type: 'security', severities: ['urgent', 'high'] },
  { text: 'show me refactor concerns', type: 'refactor', severities: [] },
  { text: 'blocking bug issues', type: 'bug', severities: ['urgent', 'high'] },
  { text: 'show me security issues', type: 'security', severities: [] },
  { text: 'perf related blocker concerns', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'show me the performance concerns', type: 'perf', severities: [] },
  { text: 'high perf issues', type: 'perf', severities: ['high'] },
  { text: 'show all low priority perf concerns', type: 'perf', severities: ['low'] },
];

export const JAPANESE_CORPUS: CorpusCase[] = [
  { text: 'パフォーマンス関連の緊急な懸念を表示', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'パフォーマンスの懸念を表示', type: 'perf', severities: [] },
  { text: '性能に関する致命的な懸念', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'パフォーマンス懸念の一覧', type: 'perf', severities: [] },
  { text: '緊急のパフォーマンス懸念を見せて', type: 'perf', severities: ['urgent', 'high'] },
  { text: '性能の懸念を教えてください', type: 'perf', severities: [] },
  { text: 'ブロックしているパフォーマンスの懸念', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'パフォーマンス関連のブロック懸念を検索', type: 'perf', severities: ['urgent', 'high'] },
  { text: '性能の軽微な懸念を表示', type: 'perf', severities: ['low'] },
  { text: 'パフォーマンスの緊急懸念', type: 'perf', severities: ['urgent', 'high'] },
  { text: '緊急の懸念を表示', type: undefined, severities: ['urgent', 'high'] },
  { text: '致命的な懸念の一覧', type: undefined, severities: ['urgent', 'high'] },
  { text: 'バグの懸念を表示', type: 'bug', severities: [] },
  { text: 'セキュリティの緊急な懸念', type: 'security', severities: ['urgent', 'high'] },
  { text: 'リファクタの懸念を検索', type: 'refactor', severities: [] },
  { text: '性能 緊急', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'パフォーマンス 致命', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'パフォーマンス関連の懸念を見せて', type: 'perf', severities: [] },
  { text: '性能に関する緊急の懸念を教えてください', type: 'perf', severities: ['urgent', 'high'] },
  { text: 'パフォーマンスの軽微な懸念', type: 'perf', severities: ['low'] },
];

/**
 * Computes the word error rate (Levenshtein over whitespace-separated words).
 *
 * @param reference - Ground-truth transcript / 正解の書き起こし
 * @param hypothesis - Recognised transcript / 認識結果
 * @returns (S + D + I) / reference word count; 0 when both are empty / 単語誤り率
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = reference.trim().split(/\s+/).filter(Boolean);
  const hyp = hypothesis.trim().split(/\s+/).filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}
