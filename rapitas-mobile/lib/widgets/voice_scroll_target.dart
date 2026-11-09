import 'package:flutter/widgets.dart';

// 音声コマンド「下にスクロール」「上にスクロール」の受け口。
//
// 一覧画面は自分の一覧をこれで包み、画面のパス（'/tasks' など）を名乗る。
// 音声コマンドは「いまの画面のパス」で受け口を探し、その下にある最初のスクロールを動かす。
// 受け口が無い画面では「この画面ではスクロールできません」と返す。

class VoiceScrollTarget extends StatefulWidget {
  /// この一覧がある画面のパス（AppRoutes と同じ値）
  final String path;
  final Widget child;

  const VoiceScrollTarget({super.key, required this.path, required this.child});

  /// [path] の画面の一覧を1画面ぶん動かす。動かせる一覧が無ければ false
  static bool scroll(String path, {required bool down}) {
    for (final state in _targets.reversed) {
      if (state.widget.path != path || !state.mounted) continue;
      final position = state._findPosition();
      if (position == null) continue;
      final delta = position.viewportDimension * 0.8 * (down ? 1 : -1);
      final to = (position.pixels + delta).clamp(position.minScrollExtent, position.maxScrollExtent);
      position.animateTo(to, duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
      return true;
    }
    return false;
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

  @override
  Widget build(BuildContext context) => widget.child;
}
