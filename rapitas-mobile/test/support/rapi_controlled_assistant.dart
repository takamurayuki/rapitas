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

  /// いちばん古い応答待ちを、振り分け先 [intent] として返す。振り分け先の処理（下書き・問い合わせ・
  /// 見守りの読み込み）は [holdFollowUps] が true の間は返さない（ラピが処理中のまま）
  void succeedAs(String intent, {String reason = 'テスト'}) =>
      _pending.removeAt(0).complete(RoutedIntent(intent: intent, reason: reason));

  /// 会話の返答を、[releaseChat] を呼ぶまで返さない（振り分けの後・返答の前を見るため）
  bool holdChat = false;
  final List<Completer<void>> _chatHeld = [];

  /// 止めていた会話の返答を返す
  void releaseChat() => _chatHeld.removeAt(0).complete();

  /// 振り分け先の処理を止めておくか（false なら失敗として返す）
  bool holdFollowUps = true;
  final List<Completer<Never>> _followUps = [];

  Future<T> _followUp<T>() {
    if (!holdFollowUps) return Future.error(Exception('network'));
    final c = Completer<Never>();
    _followUps.add(c);
    return c.future;
  }

  @override
  Future<TaskDraft> createDraft(String text) => _followUp();

  @override
  Future<AskAnswer> ask(String text) => _followUp();

  @override
  Future<SupervisionSurvey> getSupervision() => _followUp();

  /// いちばん古い応答待ちを、送信失敗にする
  void fail() => _pending.removeAt(0).completeError(Exception('network'));

  @override
  Future<CopilotReply> chat(String message,
          {List<Map<String, String>> history = const []}) async {
    if (holdChat) {
      final c = Completer<void>();
      _chatHeld.add(c);
      await c.future;
    }
    return CopilotReply(content: reply);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
