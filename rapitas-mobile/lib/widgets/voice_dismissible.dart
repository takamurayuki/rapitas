import 'package:flutter/widgets.dart';

// 音声コマンド「閉じる」「戻る」で畳める、ルートではない重なり（ドロワー・タスク一覧の検索モードなど）の受け口。
//
// シート・ダイアログ（PopupRoute）は VoiceRouteTracker が閉じる。ドロワーや画面内のモードは
// ルートではないのでそこからは見えない。重なりを出している間だけこれで包み、閉じ方（[onDismiss]）を渡す。
// 閉じるのは、いま最前面にある画面（その上に別の画面やシートが積まれていない画面）の、いちばん新しい重なりだけ。

class VoiceDismissible extends StatefulWidget {
  /// 重なりを閉じる処理（ドロワーなら closeDrawer、検索モードなら検索を閉じる）
  final VoidCallback onDismiss;
  final Widget child;

  const VoiceDismissible({super.key, required this.onDismiss, required this.child});

  /// 最前面の画面にある、いちばん新しい重なりを閉じる。閉じるものが無ければ false
  static bool dismissTop() {
    for (final state in _entries.reversed.toList()) {
      if (!state.mounted || !_onTop(state.context)) continue;
      state.widget.onDismiss();
      return true;
    }
    return false;
  }

  /// [context] のルートが、入れ子の Navigator も含めて最前面か（上に画面・シートが積まれていないか）
  static bool _onTop(BuildContext context) {
    BuildContext? current = context;
    while (current != null) {
      final route = ModalRoute.of(current);
      if (route == null) return true;
      if (!route.isCurrent) return false;
      // シェルの Navigator の中の画面なら、シェル自体が外側の Navigator で最前面かも確かめる
      current = route.navigator?.context;
    }
    return true;
  }

  static final List<_VoiceDismissibleState> _entries = [];

  @override
  State<VoiceDismissible> createState() => _VoiceDismissibleState();
}

class _VoiceDismissibleState extends State<VoiceDismissible> {
  @override
  void initState() {
    super.initState();
    VoiceDismissible._entries.add(this);
  }

  @override
  void dispose() {
    VoiceDismissible._entries.remove(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
