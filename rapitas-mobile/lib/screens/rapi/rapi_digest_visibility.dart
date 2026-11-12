import 'package:flutter/widgets.dart';
import '../../models/companion_digest.dart';

// 伴走の要約の「見せた」を測る（ラピ伴走化 第2段階-1、設計 段D「見せた位置までカーソルを進める」）。
//
// ラピの会話は、履歴があると末尾から表示する。要約カードは挨拶のすぐ後（先頭付近）にあるので、
// 長い会話では画面の外にある。画面の外にあるうちに既読を送ると、本人が見ていない動きが
// 次回から出なくなる。そこで、タスクの行ごとに「一覧の見える範囲に実際に入ったか」を測り、
// 入った行の分だけを既読にする。
//
// NOTE: 一覧は遅延生成（ListView）なので、画面から遠い行は作られてもいない。キーの RenderBox が
// 無い・付いていない行は「見えていない」として扱う。

/// 行の高さのうち、この割合以上が見える範囲に入ったら「見せた」とする（ちらっと端が覗いただけは除く）
const double digestVisibleFraction = 2 / 3;

/// 要約の行ごとの見え方を測り、まだ報告していない「見えた行」を返す
class DigestVisibilityTracker {
  final Map<String, GlobalKey> _keys = {};

  /// この画面で既読として報告した（taskId, cursor）。同じ位置を何度も送らない
  final Set<String> _reported = {};

  /// その行に付けるキー（RapiDigestCardView.itemKeyOf）
  GlobalKey keyOf(String taskId) => _keys.putIfAbsent(taskId, GlobalKey.new);

  /// [viewport] の中で、上端から [topInset] 分（透明なバーの裏で薄くなる帯）を除いた範囲に
  /// 見えている行のうち、まだ報告していないものを返し、報告済みにする。
  ///
  /// @param digest いま表示している要約
  /// @param viewport 会話の一覧の RenderBox（無ければ何も返さない）
  /// @param topInset 見える範囲から除く上端の高さ
  /// @returns 新しく見えた行
  List<DigestItem> takeNewlyVisible(CompanionDigest digest, RenderBox? viewport, double topInset) {
    if (viewport == null || !viewport.attached || !viewport.hasSize) return const [];
    final origin = viewport.localToGlobal(Offset.zero);
    final visibleTop = origin.dy + topInset;
    final visibleBottom = origin.dy + viewport.size.height;
    if (visibleBottom <= visibleTop) return const [];
    final shown = <DigestItem>[];
    for (final item in digest.items) {
      final mark = '${item.taskId}:${item.cursor}';
      if (_reported.contains(mark)) continue;
      final box = _keys[item.taskId]?.currentContext?.findRenderObject();
      if (box is! RenderBox || !box.attached || !box.hasSize) continue;
      final top = box.localToGlobal(Offset.zero).dy;
      final bottom = top + box.size.height;
      final overlap = (bottom.clamp(visibleTop, visibleBottom) - top.clamp(visibleTop, visibleBottom));
      final needed = box.size.height.clamp(0.0, visibleBottom - visibleTop) * digestVisibleFraction;
      if (box.size.height <= 0 || overlap < needed) continue;
      _reported.add(mark);
      shown.add(item);
    }
    return shown;
  }
}
