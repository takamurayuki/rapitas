import 'package:flutter/foundation.dart';

// 「ラピの入力欄にフォーカスしてキーボードを出して」という要求の受け渡し。
//
// ホーム画面のウィジェット（rapitas://app/rapi?compose=1）やショートカットから預かった依頼で
// チャット画面を開くとき、ルーター（routes.dart の redirect）が要求を出し、チャット画面
// （rapi_screen.dart）が受け取って入力欄にフォーカスを当てる。
//
// NOTE: AppRoutes.router は ProviderScope の外で static に作られるので Riverpod の ref を使えない。
// appVoiceRouteTracker と同じく、アプリ全体で1つのオブジェクトにしている。
// NOTE: 消費済みの番号はここで持つ。チャット画面はタブを切り替えるたびに作り直されるので、
// 画面側に持たせると、戻ってくるたびに古い要求でまたフォーカスしてしまう。

/// 入力欄へのフォーカス要求。要求ごとに番号を進め、受け取った側が [take] で消費する
class ComposeRequests {
  final ValueNotifier<int> _serial = ValueNotifier<int>(0);
  int _consumed = 0;

  /// 要求が出るたびに通知される（値は要求の通し番号）
  ValueListenable<int> get listenable => _serial;

  /// まだ消費されていない要求があるか
  bool get hasPending => _serial.value > _consumed;

  /// フォーカスの要求を出す
  void request() => _serial.value++;

  /// 未消費の要求があれば消費して true を返す（同じ要求で二重にフォーカスしないため）
  bool take() {
    if (!hasPending) return false;
    _consumed = _serial.value;
    return true;
  }
}

/// アプリ全体で使う要求の窓口
final ComposeRequests appComposeRequests = ComposeRequests();
