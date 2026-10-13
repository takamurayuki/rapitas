/**
 * verify-evidence-similarity.test
 *
 * 実測で選んだ閾値の固定（2026-10-13）。
 *
 * 打ち切り判定は「同じ引用証拠が一字一句同じで繰り返された」ことを要求していた。
 * 実際の差し戻し理由は毎回わずかに書き換わるため、ほぼ発火しない（verify_repair
 * が2回以上の14タスクのうち、criterion 経路 2件・厳格一致経路 1件、どちらも
 * 発火しないのが11件）。
 *
 * 数字・パス・空白を落とす正規化は**効果ゼロ**だった（実測: distinct キーが
 * 正規化前後で 5→5、発火タスク数 1→1）。差分が語レベルだったため。
 *
 * そこで文字バイグラムの Dice 係数で測った。実測値:
 *   同タスク・同一指摘   0.924 (#1168 b2~b3) / 0.863 (#1105) / 0.758 (#1168 b4~b5)
 *   異タスク間の最大     0.497 （465ペア中の最大 = 誤爆リスクの上限）
 * 閾値 0.85 で異タスク誤一致 0件、余裕 0.35。
 */
import { describe, expect, test } from 'bun:test';
import {
  EVIDENCE_SIMILARITY_THRESHOLD,
  evidenceSimilarity,
  isSameFinding,
} from './verify-evidence-similarity';

// #1168 の bounce 2 と 3。差分は「HTTP 404（…）」の挿入と「もない/がない」だけ。
const T1168_B2 =
  'research 行の存在確認 | ❌ | `GET /workflow/tasks/1168/files/research` が Resource not found\n- ❌ 拒否コマンド全文の取得試行と記録（research 担当）。research 行が存在せず、4 手段の結果もない';
const T1168_B3 =
  'research 行の存在確認 | ❌ | `GET /workflow/tasks/1168/files/research` が HTTP 404（Resource not found）\n- ❌ 拒否コマンド全文の取得試行と記録（research 担当）。research 行が存在せず、4 手段の結果がない';
// 同じ #1168 の bounce 1。同じ話題だが構造が違い、実測 0.664。
const T1168_B1 =
  '- ⚠️ 未検証（research 担当）: 拒否コマンド全文の取得試行と research 追記。`GET /workflow/tasks/1168/files/research` が Resource not found を返し、記録が\n1 | research に拒否コマンド全文と選択理由 | ❌ 未完了 | research の DB 行が存在しない。コマンドは先頭 200 字しか手元になく、全文取得の試行記録もない';
// 別タスクどうし。465ペア中で最も似ていた組（実測 0.497）。
const T1183 =
  'ユニットテスト | ⚠️ 未検証 | 0 / 未実行 | worktree に `node_modules` が無く vitest を解決できない\nTypeScript 型チェック | ⚠️ 未検証 | — | tsc バイナリを解決できない';
const T1191 =
  '自動検証(実測) | test ✅ / scope ✅ / lint ⚠️ 未検証 / typecheck ⚠️ 未検証\nユニットテスト(手動再実行) | ⚠️ 未検証 | 0 / 0 | `pnpm exec vitest` が `vitest not found`(exit 1)。`node_modules` が空';

describe('evidenceSimilarity', () => {
  test('同一文字列は 1', () => {
    expect(evidenceSimilarity(T1168_B2, T1168_B2)).toBe(1);
  });

  test('空文字どうしは 1、片方だけ空なら 0', () => {
    expect(evidenceSimilarity('', '')).toBe(1);
    expect(evidenceSimilarity(T1168_B2, '')).toBe(0);
  });

  test('空白の違いだけなら 1 に近い', () => {
    expect(evidenceSimilarity('a | b | c', 'a  |  b  |  c')).toBeGreaterThan(0.95);
  });

  // ここが本題。言い換えを同一視できること。
  test('実測 #1168: 言い換えられた同一指摘は閾値を超える', () => {
    const score = evidenceSimilarity(T1168_B2, T1168_B3);
    expect(score).toBeGreaterThanOrEqual(EVIDENCE_SIMILARITY_THRESHOLD);
    expect(score).toBeGreaterThan(0.9);
  });

  // 誤爆が最悪の失敗。進んでいるタスクを止めてはいけない。
  test('実測: 異タスク間で最も似ていた組でも閾値を超えない', () => {
    const score = evidenceSimilarity(T1183, T1191);
    expect(score).toBeLessThan(EVIDENCE_SIMILARITY_THRESHOLD);
    expect(score).toBeLessThan(0.6);
  });

  test('実測 #1168: 話題が同じでも構造が違えば閾値を超えない', () => {
    expect(evidenceSimilarity(T1168_B1, T1168_B2)).toBeLessThan(EVIDENCE_SIMILARITY_THRESHOLD);
  });

  test('閾値は異タスク最大(0.497)から十分離れている', () => {
    expect(EVIDENCE_SIMILARITY_THRESHOLD).toBeGreaterThan(0.6);
    expect(EVIDENCE_SIMILARITY_THRESHOLD).toBeLessThan(0.95);
  });

  test('1文字どうしはバイグラムが作れない — 同値のみ 1', () => {
    expect(evidenceSimilarity('a', 'a')).toBe(1);
    expect(evidenceSimilarity('a', 'b')).toBe(0);
  });
});

describe('isSameFinding', () => {
  test('一字一句同じなら true（従来の厳格一致を包含する）', () => {
    expect(isSameFinding(T1168_B2, T1168_B2)).toBe(true);
  });

  test('言い換えでも true', () => {
    expect(isSameFinding(T1168_B2, T1168_B3)).toBe(true);
  });

  test('別の指摘なら false', () => {
    expect(isSameFinding(T1183, T1191)).toBe(false);
    expect(isSameFinding(T1168_B1, T1168_B2)).toBe(false);
  });
});
