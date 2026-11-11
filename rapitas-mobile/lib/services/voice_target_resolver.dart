/// VoiceTargetResolver
///
/// Pure helpers that resolve a spoken name fragment against a list of items:
/// normalised substring matching, closeness (character-bigram Dice), and
/// lookup by id for learned corrections.
/// It does not hold state or decide when to ask the user; that is the flow's job.
library;

/// 音声コマンドの対象（名前の断片）を一覧に当てる純粋な処理。
/// 部分一致・近さ（文字バイグラムの Dice 係数）・学習した ID の引き当てだけを持つ
class VoiceTargetResolver {
  VoiceTargetResolver._();

  /// 近い候補として出す最大件数（§1.4）
  static const int maxNear = 5;

  /// これ未満の近さは候補に出さない（仮の値。実機の聞き違いの例で決め直す：設計 §8-2）
  static const double nearThreshold = 0.2;

  /// Normalises a fragment for matching: drops spaces/punctuation/brackets,
  /// folds full-width alphanumerics to half-width, and lowercases.
  ///
  /// @param s - raw text / 正規化する文字列
  /// @returns normalised text / 正規化した文字列（読みへの変換はしない）
  static String norm(String s) => s
      .replaceAllMapped(RegExp('[０-９Ａ-Ｚａ-ｚ]'), (m) => String.fromCharCode(m[0]!.codeUnitAt(0) - 0xFEE0))
      .replaceAll(RegExp(r'[\s　、。「」『』]'), '')
      .toLowerCase();

  /// Items whose normalised label contains the normalised [name].
  ///
  /// @param items - candidates in screen order / 画面の並びの候補
  /// @param name - spoken fragment / 聞き取った断片
  /// @param label - display name of an item / 項目の表示名
  /// @returns matching items in screen order / 一致した項目（画面順）
  static List<T> matching<T>(List<T> items, String name, String Function(T) label) {
    final key = norm(name);
    if (key.isEmpty) return const [];
    return items.where((item) => norm(label(item)).contains(key)).toList();
  }

  /// Sørensen–Dice coefficient over character bigrams of the normalised strings.
  ///
  /// @param a - first text / 1つ目
  /// @param b - second text / 2つ目
  /// @returns closeness in 0..1 / 近さ（0〜1）
  static double dice(String a, String b) {
    final x = _bigrams(norm(a));
    final y = _bigrams(norm(b));
    if (x.isEmpty || y.isEmpty) return 0;
    // 多重集合として数える（同じバイグラムが2回あれば2回まで当てる）
    final rest = <String, int>{};
    for (final g in y) {
      rest[g] = (rest[g] ?? 0) + 1;
    }
    var common = 0;
    for (final g in x) {
      final n = rest[g] ?? 0;
      if (n > 0) {
        common++;
        rest[g] = n - 1;
      }
    }
    return 2 * common / (x.length + y.length);
  }

  static List<String> _bigrams(String s) {
    if (s.isEmpty) return const [];
    // 1文字だけの断片はその1文字を1つの単位として比べる
    if (s.length == 1) return [s];
    return [for (var i = 0; i < s.length - 1; i++) s.substring(i, i + 2)];
  }

  /// Items close to [name], best first, at most [maxNear], ties kept in screen order.
  ///
  /// @param items - candidates in screen order / 画面の並びの候補
  /// @param name - spoken fragment that matched nothing / どれにも当たらなかった断片
  /// @param label - display name of an item / 項目の表示名
  /// @returns near candidates (may be empty) / 近い候補（無ければ空）
  static List<T> nearest<T>(List<T> items, String name, String Function(T) label) {
    final scored = <(int, double, T)>[];
    for (var i = 0; i < items.length; i++) {
      final score = dice(name, label(items[i]));
      if (score >= nearThreshold) scored.add((i, score, items[i]));
    }
    scored.sort((p, q) {
      final byScore = q.$2.compareTo(p.$2);
      return byScore != 0 ? byScore : p.$1.compareTo(q.$1);
    });
    return [for (final s in scored.take(maxNear)) s.$3];
  }

  /// The item with [id] in the current list, or null when it is not shown now.
  ///
  /// @param items - current list / いまの一覧
  /// @param id - learned target id / 学習した対象の ID
  /// @param idOf - id of an item (null if it has no stable id) / 項目の ID
  /// @returns the item or null / 見つかった項目か null
  static T? byId<T>(List<T> items, String id, String? Function(T) idOf) {
    for (final item in items) {
      if (idOf(item) == id) return item;
    }
    return null;
  }
}
