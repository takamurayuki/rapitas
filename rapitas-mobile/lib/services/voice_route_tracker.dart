import 'package:flutter/widgets.dart';

// 音声コマンド用に、いま開いているシート・ダイアログ（PopupRoute）を見張る。
//
// - 下タブ側（ShellRoute の Navigator）にシートが出ている間は、シェルの音声ボタンを隠す
//   （シェルの音声ボタンは本文より手前に描かれるので、隠さないとシートの上に浮いてしまう）
// - 「閉じる」コマンドで、いちばん上のシート・ダイアログを閉じる
//
// NavigatorObserver は1つの Navigator にしか付けられないので、root と shell で別々に持つ。

/// アプリのルーター（AppRoutes.router）に付けている見張り
final VoiceRouteTracker appVoiceRouteTracker = VoiceRouteTracker();

class VoiceRouteTracker extends ChangeNotifier {
  late final NavigatorObserver rootObserver = _PopupObserver(this, _root);
  late final NavigatorObserver shellObserver = _PopupObserver(this, _shell);

  final List<Route<dynamic>> _root = [];
  final List<Route<dynamic>> _shell = [];

  /// 音声コマンドのシート自身。「閉じる」の対象からは外す
  Route<dynamic>? voiceSheetRoute;

  static List<Route<dynamic>> _active(List<Route<dynamic>> routes) =>
      routes.where((r) => r.isActive).toList();

  /// 下タブ側にシート・ダイアログ・メニューが出ているか
  bool get hasShellPopup => _active(_shell).isNotEmpty;

  /// いちばん上のシート・ダイアログ（音声シートは除く）を閉じる。閉じるものが無ければ false
  bool closeTopPopup() {
    for (final list in [_root, _shell]) {
      final routes = _active(list).where((r) => !identical(r, voiceSheetRoute)).toList();
      if (routes.isEmpty) continue;
      final route = routes.last;
      final navigator = route.navigator;
      if (navigator == null) continue;
      navigator.removeRoute(route);
      return true;
    }
    return false;
  }

  void _changed(List<Route<dynamic>> list) {
    // 破棄された Navigator（シェルの作り直しなど）に残っていた分は捨てる
    list.removeWhere((r) => r.navigator == null);
    notifyListeners();
  }
}

class _PopupObserver extends NavigatorObserver {
  final VoiceRouteTracker _tracker;
  final List<Route<dynamic>> _routes;

  _PopupObserver(this._tracker, this._routes);

  void _add(Route<dynamic>? route) {
    if (route is PopupRoute && !_routes.contains(route)) {
      _routes.add(route);
      _tracker._changed(_routes);
    }
  }

  void _remove(Route<dynamic>? route) {
    if (route != null && _routes.remove(route)) _tracker._changed(_routes);
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => _add(route);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _remove(route);

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) => _remove(route);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    _remove(oldRoute);
    _add(newRoute);
  }
}
