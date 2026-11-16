import 'dart:async';

import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';

/// 振り分けの応答をテストから返す AssistantService（未振り分け → 会話で [reply] を返す）。
/// ラピの会話の見た目のテスト（スタンプ・三点・スクロール・Markdown）で共有する。
class ControlledAssistant implements AssistantService {
  final List<Completer<RoutedIntent>> _pending = [];

  /// 会話の返答（Markdown のまま返る）
  String reply = 'わかりました';

  /// 応答待ちの送信の数
  int get pendingCount => _pending.length;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) {
    final c = Completer<RoutedIntent>();
    _pending.add(c);
    return c.future;
  }

  /// いちばん古い応答待ちを、会話として返す
  void succeed() => _pending.removeAt(0).complete(const RoutedIntent());

  /// いちばん古い応答待ちを、送信失敗にする
  void fail() => _pending.removeAt(0).completeError(Exception('network'));

  @override
  Future<CopilotReply> chat(String message,
          {List<Map<String, String>> history = const []}) async =>
      CopilotReply(content: reply);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
