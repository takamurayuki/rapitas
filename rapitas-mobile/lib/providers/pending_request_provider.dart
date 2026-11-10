import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../config/routes.dart';
import '../services/home_screen_bridge.dart';
import 'home_widget_sync_provider.dart';
import 'rapi_chat_provider.dart';

// ショートカット「ラピに依頼」がアプリに預けた依頼の取り込みと、ホーム画面まわりの常駐処理。
//
// 依頼はアプリでの確認が要るもの（作成・変更など）と、送れなかったもの（未接続・タイムアウトなど）。
// ネイティブ側（ios/Runner/Intents）が UserDefaults に預け、ここで起動時と前面に戻るたびに
// 取り出して、ラピの入力欄へ下書きとして入れる。自動では送らない（預けてから開くまでに時間が
// 空くことがあり、古い依頼が勝手に実行されるのを避けるため。design.md §5.4）。

/// 入力欄にフォーカスした状態でラピの画面を開く（テストでは差し替える）
final rapiComposeOpenerProvider = Provider<void Function()>(
  (ref) => () => AppRoutes.router.go('${AppRoutes.rapi}?${AppRoutes.composeQuery}=1'),
);

/// 預かった依頼を取り出して、ラピの下書きにする
class PendingRequestIntake {
  final Ref _ref;
  bool _pulling = false;

  PendingRequestIntake(this._ref);

  /// 預かった依頼があれば下書きにしてラピの画面を開く
  ///
  /// @returns 依頼を取り込んだか
  Future<bool> pull() async {
    // 起動直後と resumed が重なっても、同じ依頼を二重に取り込まない
    if (_pulling) return false;
    _pulling = true;
    try {
      final requests = await _ref.read(homeScreenBridgeProvider).takePendingRequests();
      if (requests.isEmpty) return false;
      _ref.read(rapiChatProvider.notifier).receiveExternalDraft(requests);
      _ref.read(rapiComposeOpenerProvider)();
      return true;
    } finally {
      _pulling = false;
    }
  }
}

final pendingRequestIntakeProvider =
    Provider<PendingRequestIntake>((ref) => PendingRequestIntake(ref));

/// アプリの前面・裏の切り替わりで、預かった依頼の取り込みとウィジェットの書き出しをする。
/// app.dart で watch して常駐させる。iOS 以外では何もしない
final homeScreenLifecycleProvider = Provider<void>((ref) {
  if (!ref.watch(homeScreenBridgeProvider).isSupported) return;
  final intake = ref.watch(pendingRequestIntakeProvider);

  // 起動時：ルーターが最初の画面を出してから取り込む（その前に go すると最初の画面に上書きされうる）
  WidgetsBinding.instance.addPostFrameCallback((_) => intake.pull());

  final listener = AppLifecycleListener(
    onResume: intake.pull,
    // 裏へ回ると SSE が止まり、ウィジェットは次に開くまで変わらないので、ここで最新の値を書く
    onPause: () => ref.read(homeWidgetSyncProvider)?.flushNow(),
  );
  ref.onDispose(listener.dispose);
});
