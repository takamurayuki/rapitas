import 'package:flutter/material.dart';

// 音声コマンド「下にスクロール」「上にスクロール」「更新」の受け口。
//
// 各画面は本文をこれで包み、画面のパス（'/tasks' など）を名乗る。
// 音声コマンドは「いまの画面のパス」で受け口を探し、
// - スクロール：その下にある最初の縦スクロールを動かす
// - 更新：[VoiceScrollTarget.onRefresh] があればそれを、無ければ下にある「引っ張って更新」（RefreshIndicator）を動かす
// 受け口が無い画面では「この画面ではスクロールできません」「この画面では更新できません」と返す。
// パスには AppRoutes と同じ形の `:id` を含めてよい（'/tasks/:id' は '/tasks/12' に当たる）。

class VoiceScrollTarget extends StatefulWidget {
  /// この本文がある画面のパス（AppRoutes と同じ値。`:id` などの引数を含めてよい）
  final String path;

  /// 「更新」で呼ぶ処理。null なら下にある RefreshIndicator を動かす（無ければ更新できない画面）
  final Future<void> Function()? onRefresh;

  final Widget child;

  const VoiceScrollTarget({super.key, required this.path, this.onRefresh, required this.child});

  /// [path] の画面の本文を1画面ぶん動かす。動かせるスクロールが無ければ false
  static bool scroll(String path, {required bool down}) {
    for (final state in _matching(path)) {
      final position = state._findPosition();
      if (position == null) continue;
      final delta = position.viewportDimension * 0.8 * (down ? 1 : -1);
      final to = (position.pixels + delta).clamp(position.minScrollExtent, position.maxScrollExtent);
      position.animateTo(to, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      return true;
    }
    return false;
  }

  /// [path] の画面を再読み込みする（引っ張って更新・「再試行」と同じ）。更新できるものが無ければ false
  static bool refresh(String path) {
    for (final state in _matching(path)) {
      final onRefresh = state.widget.onRefresh;
      if (onRefresh != null) {
        onRefresh();
        return true;
      }
      final indicator = state._find<RefreshIndicatorState>();
      if (indicator == null) continue;
      // NOTE: show() は引っ張ったときと同じ表示を出してから onRefresh を呼ぶ（画面の更新処理を二重に持たない）
      indicator.show();
      return true;
    }
    return false;
  }

  /// パスが [path] に当たる受け口（新しく開いた画面＝上にある画面から順に）
  static Iterable<_VoiceScrollTargetState> _matching(String path) =>
      _targets.reversed.where((s) => s.mounted && matchesPath(s.widget.path, path));

  /// 受け口のパス [pattern]（`:id` などを含んでよい）が、実際のパス [path] に当たるか
  static bool matchesPath(String pattern, String path) {
    if (!pattern.contains(':')) return pattern == path;
    final a = pattern.split('/');
    final b = path.split('/');
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].startsWith(':')) {
        if (b[i].isEmpty) return false;
      } else if (a[i] != b[i]) {
        return false;
      }
    }
    return true;
  }

  static final List<_VoiceScrollTargetState> _targets = [];

  @override
  State<VoiceScrollTarget> createState() => _VoiceScrollTargetState();
}

class _VoiceScrollTargetState extends State<VoiceScrollTarget> {
  @override
  void initState() {
    super.initState();
    VoiceScrollTarget._targets.add(this);
  }

  @override
  void dispose() {
    VoiceScrollTarget._targets.remove(this);
    super.dispose();
  }

  /// 下にある最初の縦スクロールの位置
  ScrollPosition? _findPosition() {
    ScrollPosition? found;
    void visit(Element element) {
      if (found != null) return;
      if (element is StatefulElement && element.state is ScrollableState) {
        final scrollable = element.state as ScrollableState;
        if (scrollable.axisDirection == AxisDirection.down || scrollable.axisDirection == AxisDirection.up) {
          found = scrollable.position;
          return;
        }
      }
      element.visitChildElements(visit);
    }

    context.visitChildElements(visit);
    return found;
  }

  /// 下にある最初の [T] の State
  T? _find<T extends State>() {
    T? found;
    void visit(Element element) {
      if (found != null) return;
      if (element is StatefulElement && element.state is T) {
        found = element.state as T;
        return;
      }
      element.visitChildElements(visit);
    }

    context.visitChildElements(visit);
    return found;
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
