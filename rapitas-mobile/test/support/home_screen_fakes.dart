import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/home_screen_bridge.dart';

// ショートカット「ラピに依頼」まわりのテストで共有する差し替え。

/// ネイティブの置き場（RapiPendingStore）の代わり。peek は読むだけ、ack で消す
class FakeHomeScreenBridge implements HomeScreenBridge {
  List<PendingRapiRequest> pending = [];
  final List<List<String>> acked = [];
  int peeks = 0;

  @override
  bool get isSupported => true;

  @override
  Future<void> writeWidgetSnapshot(Map<String, Object?> snapshot) async {}

  @override
  Future<List<PendingRapiRequest>> peekPendingRequests() async {
    peeks++;
    return [...pending];
  }

  @override
  Future<void> ackPendingRequests(List<String> ids) async {
    acked.add(ids);
    pending = [for (final r in pending) if (!ids.contains(r.id)) r];
  }
}

/// 振り分けは常に会話、返事は固定。[failNext] なら次の送信を失敗させる
class FakeAssistant implements AssistantService {
  final List<String> routed = [];
  bool failNext = false;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    if (failNext) {
      failNext = false;
      throw Exception('offline');
    }
    routed.add(text);
    return const RoutedIntent();
  }

  @override
  Future<CopilotReply> chat(String message, {List<Map<String, String>> history = const []}) async =>
      const CopilotReply(content: 'わかりました');

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const createRequest = PendingRapiRequest(id: 'r-create', text: '明日までに資料を作るタスクを追加');
const offlineRequest = PendingRapiRequest(id: 'r-offline', text: 'レビューの状況は？', reason: 'offline');
